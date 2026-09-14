/* Native camera candidate. No credential, SSID, image or URL logging. */
#include "cJSON.h"
#include "camera-setup.h"
#include "driver/sdmmc_host.h"
#include "esp_camera.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_vfs_fat.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "hsx-build.h"
#include "hsx-profile.h"
#include "mbedtls/sha256.h"
#include "nvs_flash.h"
#include "observation-spool.h"
#include "sdmmc_cmd.h"
#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#define SPOOL "/sdcard/albus-observations"
#define QUARANTINE "/sdcard/albus-quarantine"
static EventGroupHandle_t events;
#define CONNECTED BIT0
#define CLOCK_READY BIT1
#define STORAGE_READY BIT2
#define AUTH_PAUSED BIT3
static SemaphoreHandle_t camera_lock, spool_lock;
static char claimed[37];
static const char *device_id, *observation_url, *token;
static unsigned dropped_count, corrupt_count, quarantine_dropped,
    quarantine_count;
static size_t queued_count, queued_bytes;
static int64_t last_capture, last_successful_upload;
static int last_http_status;
static const char *last_error = "none";
static void error_state(const char *error) {
  xSemaphoreTake(spool_lock, portMAX_DELAY);
  last_error = error;
  xSemaphoreGive(spool_lock);
}
static void fail_closed(void) {
  ESP_LOGE("camera", "Runtime configuration or hardware unavailable");
  for (;;)
    vTaskDelay(pdMS_TO_TICKS(60000));
}
static const char *field(cJSON *j, const char *key, size_t maximum) {
  cJSON *v = cJSON_GetObjectItemCaseSensitive(j, key);
  return cJSON_IsString(v) && strlen(v->valuestring) > 0 &&
                 strlen(v->valuestring) <= maximum
             ? v->valuestring
             : NULL;
}
static bool number(cJSON *j, const char *key, double expected) {
  cJSON *v = cJSON_GetObjectItemCaseSensitive(j, key);
  return cJSON_IsNumber(v) && v->valuedouble == expected;
}
static void digest(const unsigned char *bytes, size_t length, char out[65]) {
  unsigned char hash[32];
  mbedtls_sha256(bytes, length, hash, 0);
  for (unsigned i = 0; i < 32; i++)
    snprintf(out + 2 * i, 3, "%02x", hash[i]);
}
static void uuid(char out[37]) {
  unsigned char b[16];
  esp_fill_random(b, sizeof b);
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  snprintf(
      out, 37,
      "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
      b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11],
      b[12], b[13], b[14], b[15]);
}
static void wifi_event(void *arg, esp_event_base_t base, int32_t id,
                       void *data) {
  (void)arg;
  (void)data;
  if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP)
    xEventGroupSetBits(events, CONNECTED);
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    xEventGroupClearBits(events, CONNECTED);
    esp_wifi_connect();
  }
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START)
    esp_wifi_connect();
}
static bool jpeg(unsigned char **bytes, size_t *length) {
  *bytes = NULL;
  *length = 0;
  if (xSemaphoreTake(camera_lock, pdMS_TO_TICKS(5000)) != pdTRUE)
    return false;
  /* Discard the queued frame: a 15-minute interval must not upload the previous
   * preview. */
  camera_fb_t *frame = esp_camera_fb_get();
  if (frame)
    esp_camera_fb_return(frame);
  frame = esp_camera_fb_get();
  bool ok = frame && frame->format == PIXFORMAT_RGB565 && frame->width == 320 &&
            frame->height == 240 && frame2jpg(frame, 80, bytes, length);
  if (frame) {
    esp_camera_fb_return(frame);
  }
  xSemaphoreGive(camera_lock);
  if (!ok || !*bytes || !*length || *length > OBS_MAX_BYTES) {
    free(*bytes);
    *bytes = NULL;
    return false;
  }
  return true;
}
static esp_err_t preview(httpd_req_t *request) {
  unsigned char *bytes;
  size_t length;
  if (!jpeg(&bytes, &length)) {
    httpd_resp_set_status(request, "503 Service Unavailable");
    httpd_resp_sendstr(request, "Camera busy");
    return ESP_OK;
  }
  httpd_resp_set_type(request, "image/jpeg");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  esp_err_t result = httpd_resp_send(request, (const char *)bytes, length);
  free(bytes);
  return result;
}
static esp_err_t health(httpd_req_t *request) {
  EventBits_t bits = xEventGroupGetBits(events);
  char body[600];
  if (xSemaphoreTake(spool_lock, pdMS_TO_TICKS(1000)) != pdTRUE) {
    httpd_resp_set_status(request, "503 Service Unavailable");
    return httpd_resp_sendstr(request, "Storage busy");
  }
  snprintf(body, sizeof body,
           "{\"clock_ready\":%s,\"storage_ready\":%s,\"upload_paused\":%s,"
           "\"queued_count\":%zu,\"queued_bytes\":%zu,\"last_capture\":%lld,"
           "\"last_successful_upload\":%lld,\"last_error\":\"%s\",\"last_http_"
           "status\":%d,\"dropped\":%u,\"corrupt\":%u,\"quarantined\":%u,"
           "\"quarantine_dropped\":%u}",
           bits & CLOCK_READY ? "true" : "false",
           bits & STORAGE_READY ? "true" : "false",
           bits & AUTH_PAUSED ? "true" : "false", queued_count, queued_bytes,
           (long long)last_capture, (long long)last_successful_upload,
           last_error, last_http_status, dropped_count, corrupt_count,
           quarantine_count, quarantine_dropped);
  xSemaphoreGive(spool_lock);
  httpd_resp_set_type(request, "application/json");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  return httpd_resp_sendstr(request, body);
}
static void camera_init(void) {
  camera_config_t config = {.pin_pwdn = -1,
                            .pin_reset = -1,
                            .pin_xclk = 15,
                            .pin_sccb_sda = 4,
                            .pin_sccb_scl = 5,
                            .pin_d0 = 11,
                            .pin_d1 = 9,
                            .pin_d2 = 8,
                            .pin_d3 = 10,
                            .pin_d4 = 12,
                            .pin_d5 = 18,
                            .pin_d6 = 17,
                            .pin_d7 = 16,
                            .pin_vsync = 6,
                            .pin_href = 7,
                            .pin_pclk = 13,
                            .xclk_freq_hz = 20000000,
                            .ledc_timer = LEDC_TIMER_0,
                            .ledc_channel = LEDC_CHANNEL_0,
                            .pixel_format = PIXFORMAT_RGB565,
                            .frame_size = FRAMESIZE_QVGA,
                            .jpeg_quality = 12,
                            .fb_count = 2,
                            .fb_location = CAMERA_FB_IN_PSRAM,
                            .grab_mode = CAMERA_GRAB_LATEST};
  if (esp_camera_init(&config) != ESP_OK) {
    fail_closed();
  }
  sensor_t *sensor = esp_camera_sensor_get();
  if (!sensor || sensor->id.PID != 0x009b ||
      sensor->set_agc_gain(sensor, 10) != 0)
    fail_closed();
}
static bool mount_sd(void) {
  sdmmc_host_t host = SDMMC_HOST_DEFAULT();
  host.max_freq_khz = SDMMC_FREQ_PROBING;
  sdmmc_slot_config_t slot = SDMMC_SLOT_CONFIG_DEFAULT();
  slot.width = 1;
  slot.clk = GPIO_NUM_39;
  slot.cmd = GPIO_NUM_38;
  slot.d0 = GPIO_NUM_40;
  slot.flags |= SDMMC_SLOT_FLAG_INTERNAL_PULLUP;
  esp_vfs_fat_mount_config_t mount = {.format_if_mount_failed = false,
                                      .max_files = 6,
                                      .allocation_unit_size = 16384};
  sdmmc_card_t *card = NULL;
  if (esp_vfs_fat_sdmmc_mount("/sdcard", &host, &slot, &mount, &card) != ESP_OK)
    return false;
  if (mkdir(SPOOL, 0700) != 0 && errno != EEXIST)
    return false;
  if (mkdir(QUARANTINE, 0700) != 0 && errno != EEXIST)
    return false;
  /* Test write/fsync before enabling capture; never format a user's card. */
  char path[] = SPOOL "/.write-check";
  FILE *file = fopen(path, "wb");
  if (!file)
    return false;
  bool ok = fwrite("1", 1, 1, file) == 1 && fflush(file) == 0 &&
            fsync(fileno(file)) == 0;
  if (fclose(file))
    ok = false;
  if (unlink(path))
    ok = false;
  return ok;
}
static void scan_account(const obs_spool_stats *stats) {
  queued_count = stats->count;
  queued_bytes = stats->bytes;
  dropped_count += stats->dropped;
  corrupt_count += stats->corrupt;
  if (stats->dropped || stats->corrupt)
    ESP_LOGW("camera", "Spool loss: dropped=%u corrupt=%u", dropped_count,
             corrupt_count);
}
static void capture_task(void *arg) {
  (void)arg;
  xEventGroupWaitBits(events, CLOCK_READY, pdFALSE, pdTRUE, portMAX_DELAY);
  int64_t next = esp_timer_get_time() + (esp_random() % 15001) * 1000LL;
  for (;;) {
    int64_t mono = esp_timer_get_time();
    if (mono < next) {
      vTaskDelay(pdMS_TO_TICKS(250));
      continue;
    }
    next = obs_next_deadline(next, mono);
    if (!(xEventGroupGetBits(events) & STORAGE_READY) ||
        (xEventGroupGetBits(events) & AUTH_PAUSED))
      continue;
    time_t captured = time(NULL);
    if (captured < 1700000000)
      continue;
    unsigned char *bytes;
    size_t length;
    if (!jpeg(&bytes, &length)) {
      error_state("capture_failed");
      ESP_LOGW("camera", "Capture failed");
      continue;
    }
    obs_record record = {.captured_at = captured, .bytes = length};
    uuid(record.id);
    digest(bytes, length, record.sha256);
    xSemaphoreTake(spool_lock, portMAX_DELAY);
    obs_record oldest;
    obs_spool_stats stats;
    bool ok = obs_spool_scan(SPOOL, captured, claimed, length, &oldest, &stats);
    scan_account(&stats);
    if (ok)
      ok = obs_spool_put(SPOOL, &record, bytes);
    if (ok) {
      queued_count++;
      queued_bytes += length + 160;
      last_capture = captured;
      last_error = "none";
    }
    if (!ok) {
      xEventGroupClearBits(events, STORAGE_READY);
      last_error = "sd_unavailable";
      ESP_LOGE("camera", "SD spool unavailable; capture paused");
    }
    xSemaphoreGive(spool_lock);
    free(bytes);
  }
}
typedef struct {
  char body[1025];
  size_t length;
  bool overflow;
  unsigned retry_after;
} response_buffer;
static esp_err_t http_event(esp_http_client_event_t *event) {
  response_buffer *response = event->user_data;
  if (!response)
    return ESP_OK;
  if (event->event_id == HTTP_EVENT_ON_DATA) {
    if (event->data_len < 0 ||
        response->length + (size_t)event->data_len >= sizeof response->body) {
      response->overflow = true;
      return ESP_FAIL;
    }
    memcpy(response->body + response->length, event->data, event->data_len);
    response->length += event->data_len;
    response->body[response->length] = 0;
  }
  if (event->event_id == HTTP_EVENT_ON_HEADER && event->header_key &&
      !strcasecmp(event->header_key, "Retry-After")) {
    char *end;
    unsigned long delay = strtoul(event->header_value, &end, 10);
    if (end != event->header_value && !*end)
      response->retry_after = delay > 3600 ? 3600 : (unsigned)delay;
  }
  return ESP_OK;
}
static bool exact_ack(const response_buffer *response,
                      const obs_record *record) {
  if (response->overflow || !response->length) {
    return false;
  }
  cJSON *ack = cJSON_Parse(response->body);
  if (!ack)
    return false;
  const char *id = field(ack, "observation_id", 36),
             *sha = field(ack, "sha256", 64), *state = field(ack, "state", 16),
             *received = field(ack, "received_at", 40);
  bool ok = id && sha && state && received && !strcmp(id, record->id) &&
            !strcmp(sha, record->sha256) && !strcmp(state, "stored") &&
            number(ack, "bytes", record->bytes);
  cJSON_Delete(ack);
  return ok;
}
static void upload_task(void *arg) {
  (void)arg;
  unsigned failures = 0;
  for (;;) {
    xEventGroupWaitBits(events, CONNECTED | CLOCK_READY | STORAGE_READY,
                        pdFALSE, pdTRUE, portMAX_DELAY);
    if (xEventGroupGetBits(events) & AUTH_PAUSED) {
      vTaskDelay(pdMS_TO_TICKS(60000));
      continue;
    }
    obs_record record = {0};
    obs_spool_stats stats;
    unsigned char *bytes = NULL;
    xSemaphoreTake(spool_lock, portMAX_DELAY);
    bool ok = obs_spool_scan(SPOOL, time(NULL), NULL, 0, &record, &stats);
    scan_account(&stats);
    obs_spool_stats qstats = {0};
    if (ok)
      ok = obs_quarantine_scan(QUARANTINE, time(NULL), &qstats);
    quarantine_count = qstats.count;
    quarantine_dropped += qstats.dropped + qstats.corrupt;
    if (ok && record.id[0]) {
      strcpy(claimed, record.id);
      ok = obs_spool_read(SPOOL, record.id, &record, &bytes);
    }
    if (!ok)
      xEventGroupClearBits(events, STORAGE_READY);
    xSemaphoreGive(spool_lock);
    if (!bytes) {
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }
    char actual[65];
    digest(bytes, record.bytes, actual);
    if (strcmp(actual, record.sha256)) {
      xSemaphoreTake(spool_lock, portMAX_DELAY);
      if (!obs_spool_remove(SPOOL, record.id))
        xEventGroupClearBits(events, STORAGE_READY);
      claimed[0] = 0;
      corrupt_count++;
      last_error = "payload_corrupt";
      xSemaphoreGive(spool_lock);
      free(bytes);
      continue;
    }
    char authorization[51], captured[24];
    snprintf(authorization, sizeof authorization, "Bearer %s", token);
    snprintf(captured, sizeof captured, "%lld", (long long)record.captured_at);
    response_buffer response = {0};
    esp_http_client_config_t config = {.url = observation_url,
                                       .timeout_ms = 20000,
                                       .crt_bundle_attach =
                                           esp_crt_bundle_attach,
                                       .disable_auto_redirect = true,
                                       .method = HTTP_METHOD_POST,
                                       .event_handler = http_event,
                                       .user_data = &response};
    esp_http_client_handle_t client = esp_http_client_init(&config);
    int status = 0;
    esp_err_t sent = ESP_FAIL;
    if (client) {
      esp_http_client_set_header(client, "Authorization", authorization);
      esp_http_client_set_header(client, "Content-Type", "image/jpeg");
      esp_http_client_set_header(client, "X-Observation-Id", record.id);
      esp_http_client_set_header(client, "X-Capability-Id", "camera");
      esp_http_client_set_header(client, "X-Payload-Schema", "jpeg.v1");
      esp_http_client_set_header(client, "X-Captured-At", captured);
      esp_http_client_set_header(client, "X-Content-SHA256", record.sha256);
      esp_http_client_set_post_field(client, (const char *)bytes, record.bytes);
      sent = esp_http_client_perform(client);
      status = esp_http_client_get_status_code(client);
      esp_http_client_cleanup(client);
    }
    free(bytes);
    obs_action action =
        sent == ESP_OK
            ? obs_response_action(status, exact_ack(&response, &record))
            : OBS_RETRY;
    xSemaphoreTake(spool_lock, portMAX_DELAY);
    last_http_status = status;
    if (action == OBS_ACK) {
      last_successful_upload = time(NULL);
      last_error = "none";
    } else if (action == OBS_QUARANTINE)
      last_error = "frame_rejected";
    else if (action == OBS_PAUSE)
      last_error = "auth_paused";
    else if (action == OBS_RETRY)
      last_error = sent == ESP_OK ? "ack_mismatch_or_retry" : "network_error";
    bool removed = false;
    if (action == OBS_ACK || action == OBS_DROP_EXPIRED) {
      removed = obs_spool_remove(SPOOL, record.id);
      if (action == OBS_DROP_EXPIRED)
        dropped_count++;
    }
    if (action == OBS_QUARANTINE) {
      obs_spool_stats quarantine = {0};
      removed = obs_spool_quarantine(SPOOL, QUARANTINE, &record, time(NULL),
                                     &quarantine);
      quarantine_count = quarantine.count;
      quarantine_dropped += quarantine.dropped + quarantine.corrupt;
    }
    if (action == OBS_ACK || action == OBS_DROP_EXPIRED ||
        action == OBS_QUARANTINE) {
      if (!removed) {
        xEventGroupClearBits(events, STORAGE_READY);
        last_error = "sd_unavailable";
      } else {
        if (queued_count)
          queued_count--;
        if (queued_bytes >= record.bytes + 160)
          queued_bytes -= record.bytes + 160;
      }
    }
    claimed[0] = 0;
    xSemaphoreGive(spool_lock);
    if (action == OBS_PAUSE) {
      xEventGroupSetBits(events, AUTH_PAUSED);
      ESP_LOGE("camera", "Upload rejected; queue retained for intervention");
    }
    if (action == OBS_ACK || action == OBS_DROP_EXPIRED ||
        action == OBS_QUARANTINE) {
      failures = 0;
      vTaskDelay(pdMS_TO_TICKS(10000));
    } else {
      unsigned delay =
          obs_retry_seconds(failures, esp_random(), response.retry_after);
      if (failures < 10)
        failures++;
      vTaskDelay(pdMS_TO_TICKS(delay * 1000));
    }
  }
}
static void wifi_watch(void *arg) {
  (void)arg;
  unsigned disconnected = 0;
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(15000));
    if (xEventGroupGetBits(events) & CONNECTED) {
      disconnected = 0;
      camera_setup_stop();
    } else if (++disconnected >= 4)
      camera_setup_start();
  }
}
void hsx_camera_run(void) {
  nvs_handle_t store;
  if (nvs_flash_init_partition("albus_cfg") != ESP_OK ||
      nvs_open_from_partition("albus_cfg", "albus", NVS_READONLY, &store) !=
          ESP_OK)
    fail_closed();
  size_t size = 0;
  if (nvs_get_str(store, "config", NULL, &size) != ESP_OK || size < 2 ||
      size > 16384)
    fail_closed();
  char *raw = malloc(size);
  if (!raw || nvs_get_str(store, "config", raw, &size) != ESP_OK)
    fail_closed();
  nvs_close(store);
  cJSON *cfg = cJSON_Parse(raw);
  free(raw);
  if (!cfg)
    fail_closed();
  device_id = field(cfg, "device_id", 36);
  token = field(cfg, "token", 43);
  observation_url = field(cfg, "observation_url", 256);
  const char *profile = field(cfg, "profile_id", 120),
             *runtime = field(cfg, "runtime", 30),
             *build = field(cfg, "build_id", 36);
  if (!number(cfg, "v", 2) || !device_id || !obs_uuid_valid(device_id) ||
      !token || strlen(token) != 43 || !observation_url ||
      strncmp(observation_url, "https://", 8) || strchr(observation_url, '?') ||
      strchr(observation_url, '#') || strchr(observation_url, '@') ||
      !profile || strcmp(profile, HSX_PROFILE_ID) || !runtime ||
      strcmp(runtime, HSX_RUNTIME) || !build || strcmp(build, HSX_BUILD_ID) ||
      !number(cfg, "plan_version", HSX_PLAN_VERSION) ||
      !number(cfg, "code_version", HSX_CODE_VERSION))
    fail_closed();
  char suffix[100];
  snprintf(suffix, sizeof suffix, "/ingest/v2/devices/%s/observations",
           device_id);
  size_t url_size = strlen(observation_url), suffix_size = strlen(suffix);
  if (url_size <= 8 + suffix_size ||
      strcmp(observation_url + url_size - suffix_size, suffix))
    fail_closed();
  for (size_t i = 0; i < 43; i++)
    if (!((token[i] >= 'A' && token[i] <= 'Z') ||
          (token[i] >= 'a' && token[i] <= 'z') ||
          (token[i] >= '0' && token[i] <= '9') || token[i] == '_' ||
          token[i] == '-'))
      fail_closed();
  cJSON *caps = cJSON_GetObjectItemCaseSensitive(cfg, "capabilities"),
        *cap = cJSON_GetArrayItem(caps, 0);
  const char *id = field(cap, "id", 64), *kind = field(cap, "kind", 20),
             *schema = field(cap, "schema", 20),
             *cap_profile = field(cap, "profile_id", 120);
  if (!cJSON_IsArray(caps) || cJSON_GetArraySize(caps) != 1 || !id ||
      strcmp(id, "camera") || !kind || strcmp(kind, "image") || !schema ||
      strcmp(schema, "jpeg.v1") || !cap_profile ||
      strcmp(cap_profile, HSX_PROFILE_ID) ||
      !number(cap, "profile_version", 1) || !number(cap, "interval_s", 900) ||
      !number(cap, "max_bytes", OBS_MAX_BYTES) ||
      !number(cap, "max_width", 320) || !number(cap, "max_height", 240) ||
      !cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(cap, "enabled")) ||
      !cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(cap, "required")))
    fail_closed();
  events = xEventGroupCreate();
  camera_lock = xSemaphoreCreateMutex();
  spool_lock = xSemaphoreCreateMutex();
  if (!events || !camera_lock || !spool_lock)
    fail_closed();
  camera_init();
  if (mount_sd()) {
    obs_record oldest;
    obs_spool_stats initial = {0}, quarantine = {0};
    if (obs_spool_scan(SPOOL, 0, NULL, 0, &oldest, &initial) &&
        obs_quarantine_scan(QUARANTINE, 0, &quarantine)) {
      scan_account(&initial);
      quarantine_count = quarantine.count;
      quarantine_dropped = quarantine.dropped + quarantine.corrupt;
      xEventGroupSetBits(events, STORAGE_READY);
    } else
      last_error = "sd_unavailable";
  } else {
    last_error = "sd_unavailable";
    ESP_LOGE("camera", "SD unavailable; local preview only");
  }
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_create_default_wifi_sta();
  esp_netif_create_default_wifi_ap();
  wifi_init_config_t wi = WIFI_INIT_CONFIG_DEFAULT();
  wi.nvs_enable = 0;
  ESP_ERROR_CHECK(esp_wifi_init(&wi));
  ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
  ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                             wifi_event, NULL));
  ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                             wifi_event, NULL));
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  bool configured = camera_wifi_configure(cfg);
  if (!configured)
    camera_setup_start();
  ESP_ERROR_CHECK(esp_wifi_start());
  httpd_handle_t server;
  httpd_config_t http = HTTPD_DEFAULT_CONFIG();
  http.stack_size = 8192;
  http.max_uri_handlers = 12;
  http.recv_wait_timeout = 5;
  http.send_wait_timeout = 5;
  if (httpd_start(&server, &http) == ESP_OK) {
    httpd_uri_t image = {.uri = "/snapshot",
                         .method = HTTP_GET,
                         .handler = preview},
                status = {
                    .uri = "/health", .method = HTTP_GET, .handler = health};
    httpd_register_uri_handler(server, &image);
    httpd_register_uri_handler(server, &status);
    camera_setup_routes(server);
  }
  if (xTaskCreate(wifi_watch, "wifi-watch", 4096, NULL, 2, NULL) != pdPASS)
    fail_closed();
  xEventGroupWaitBits(events, CONNECTED, pdFALSE, pdTRUE, portMAX_DELAY);
  camera_setup_stop();
  esp_sntp_config_t ntp = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
  ESP_ERROR_CHECK(esp_netif_sntp_init(&ntp));
  while (esp_netif_sntp_sync_wait(pdMS_TO_TICKS(30000)) != ESP_OK) {
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
  xEventGroupSetBits(events, CLOCK_READY);
  if (xTaskCreate(capture_task, "capture", 8192, NULL, 4, NULL) != pdPASS ||
      xTaskCreate(upload_task, "upload", 12288, NULL, 3, NULL) != pdPASS)
    fail_closed();
}
