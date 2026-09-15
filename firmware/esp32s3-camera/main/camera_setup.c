#include "camera-setup.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "lwip/inet.h"
#include "lwip/sockets.h"
#include "nvs_flash.h"
#include "setup-form.h"
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static atomic_bool active, dns_started;
static char csrf[33];
static SemaphoreHandle_t nonce_lock;
static void nonce_copy(char out[33]) {
  if (nonce_lock)
    xSemaphoreTake(nonce_lock, portMAX_DELAY);
  memcpy(out, csrf, 33);
  if (nonce_lock)
    xSemaphoreGive(nonce_lock);
}
static bool configure(const char *ssid, const char *password) {
  if (!setup_wifi_valid(ssid, password))
    return false;
  wifi_config_t station = {0};
  memcpy(station.sta.ssid, ssid, strlen(ssid));
  memcpy(station.sta.password, password, strlen(password));
  station.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
  return esp_wifi_set_config(WIFI_IF_STA, &station) == ESP_OK;
}
bool camera_wifi_configure(cJSON *config) {
  char raw[512] = {0};
  size_t size = sizeof raw;
  nvs_handle_t store;
  if (nvs_open_from_partition("albus_cfg", "albus", NVS_READONLY, &store) ==
      ESP_OK) {
    bool saved = nvs_get_str(store, "wifi_local", raw, &size) == ESP_OK;
    nvs_close(store);
    if (saved) {
      cJSON *local = cJSON_Parse(raw);
      memset(raw, 0, sizeof raw);
      cJSON *ssid = cJSON_GetObjectItemCaseSensitive(local, "ssid"),
            *password = cJSON_GetObjectItemCaseSensitive(local, "password");
      bool ok = cJSON_IsString(ssid) && cJSON_IsString(password) &&
                configure(ssid->valuestring, password->valuestring);
      cJSON_Delete(local);
      if (ok)
        return true;
    }
  }
  cJSON *s = cJSON_GetObjectItemCaseSensitive(config, "wifi_ssid"),
        *p = cJSON_GetObjectItemCaseSensitive(config, "wifi_password");
  return cJSON_IsString(s) && cJSON_IsString(p) &&
         configure(s->valuestring, p->valuestring);
}
static bool ap_request(httpd_req_t *request) {
  struct sockaddr_in address;
  socklen_t size = sizeof address;
  int socket = httpd_req_to_sockfd(request);
  return active &&
         getsockname(socket, (struct sockaddr *)&address, &size) == 0 &&
         address.sin_addr.s_addr == inet_addr("192.168.4.1");
}
static bool canonical_host(httpd_req_t *request) {
  char host[32];
  return httpd_req_get_hdr_value_str(request, "Host", host, sizeof host) ==
             ESP_OK &&
         setup_host_allowed(host);
}
static bool same_origin(httpd_req_t *request) {
  char origin[40];
  esp_err_t result =
      httpd_req_get_hdr_value_str(request, "Origin", origin, sizeof origin);
  return result == ESP_ERR_NOT_FOUND ||
         (result == ESP_OK && setup_origin_allowed(origin));
}
static esp_err_t page(httpd_req_t *request) {
  if (!ap_request(request)) {
    httpd_resp_send_err(request, HTTPD_404_NOT_FOUND, "Not found");
    return ESP_OK;
  }
  if (!canonical_host(request)) {
    httpd_resp_set_status(request, "302 Found");
    httpd_resp_set_hdr(request, "Location", "http://192.168.4.1/");
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    return httpd_resp_sendstr(request, "Open the board setup address.");
  }
  char html[1200], nonce[33];
  nonce_copy(nonce);
  snprintf(html, sizeof html,
           "<!doctype html><html><meta name=viewport "
           "content='width=device-width,initial-scale=1'><title>Plant-A "
           "Setup</title><body><h1>Plant-A Setup</h1><p>Wi-Fi credentials stay "
           "on this board.</p><form method=post "
           "action='http://192.168.4.1/setup'><input type=hidden name=csrf "
           "value='%s'><p><label>Network <input name=ssid maxlength=32 "
           "required autocomplete=off></label></p><p><label>Password <input "
           "type=password name=password minlength=8 maxlength=63 required "
           "autocomplete=off></label></p><button>Connect</button></form><p><a "
           "href=/snapshot>Camera preview</a></p></body></html>",
           nonce);
  httpd_resp_set_type(request, "text/html");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_set_hdr(request, "Content-Security-Policy",
                     "default-src 'none'; form-action http://192.168.4.1; "
                     "frame-ancestors 'none'");
  return httpd_resp_sendstr(request, html);
}
static esp_err_t save(httpd_req_t *request) {
  if (!ap_request(request) || !canonical_host(request) ||
      !same_origin(request) || request->content_len <= 0 ||
      request->content_len > 512) {
    httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST,
                        "Invalid setup request");
    return ESP_OK;
  }
  char body[513] = {0};
  size_t offset = 0;
  while (offset < (size_t)request->content_len) {
    int n =
        httpd_req_recv(request, body + offset, request->content_len - offset);
    if (n <= 0) {
      httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Incomplete request");
      return ESP_OK;
    }
    offset += n;
  }
  char ssid[33], password[64];
  char nonce[33];
  nonce_copy(nonce);
  bool valid =
      ap_request(request) && setup_form_parse(body, nonce, ssid, password);
  memset(body, 0, sizeof body);
  if (!valid) {
    memset(password, 0, sizeof password);
    httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST,
                        "Invalid Wi-Fi settings");
    return ESP_OK;
  }
  /* One NVS blob binds both values atomically; two-key commit could tear. */
  cJSON *value = cJSON_CreateObject();
  cJSON_AddStringToObject(value, "ssid", ssid);
  cJSON_AddStringToObject(value, "password", password);
  char *serialized = cJSON_PrintUnformatted(value);
  cJSON_Delete(value);
  nvs_handle_t store;
  bool saved =
      serialized && nvs_open_from_partition("albus_cfg", "albus", NVS_READWRITE,
                                            &store) == ESP_OK;
  if (saved) {
    saved = nvs_set_str(store, "wifi_local", serialized) == ESP_OK &&
            nvs_commit(store) == ESP_OK;
    nvs_close(store);
  }
  if (serialized) {
    memset(serialized, 0, strlen(serialized));
    free(serialized);
  }
  if (!saved) {
    memset(password, 0, sizeof password);
    httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR,
                        "Unable to save settings");
    return ESP_OK;
  }
  esp_wifi_disconnect();
  bool configured = configure(ssid, password);
  memset(password, 0, sizeof password);
  if (!configured) {
    httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR,
                        "Unable to configure Wi-Fi");
    return ESP_OK;
  }
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_sendstr(
      request,
      "Saved. Connecting to Wi-Fi; this setup hotspot closes after connection. "
      "If it stays open, reconnect here and correct the settings.");
  esp_wifi_connect();
  return ESP_OK;
}
static void dns(void *arg) {
  (void)arg;
  int socket_fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (socket_fd < 0) {
    dns_started = false;
    vTaskDelete(NULL);
    return;
  }
  struct sockaddr_in address = {.sin_family = AF_INET,
                                .sin_port = htons(53),
                                .sin_addr.s_addr = inet_addr("192.168.4.1")};
  /* First boot starts setup before esp_wifi_start; wait until the AP netif
   * actually owns 192.168.4.1 rather than permanently losing captive DNS. */
  while (bind(socket_fd, (struct sockaddr *)&address, sizeof address)) {
    if (!active) {
      close(socket_fd);
      dns_started = false;
      vTaskDelete(NULL);
      return;
    }
    vTaskDelay(pdMS_TO_TICKS(250));
  }
  for (;;) {
    unsigned char buffer[512];
    struct sockaddr_in peer;
    socklen_t peer_size = sizeof peer;
    int n = recvfrom(socket_fd, buffer, sizeof buffer - 16, 0,
                     (struct sockaddr *)&peer, &peer_size);
    if (!active || n < 17 || buffer[4] != 0 || buffer[5] != 1)
      continue;
    size_t end = 12;
    bool valid = true;
    while (end < (size_t)n && buffer[end]) {
      unsigned len = buffer[end];
      if (len > 63 || end + len + 1 >= (size_t)n) {
        valid = false;
        break;
      }
      end += len + 1;
    }
    if (!valid || end + 5 > (size_t)n)
      continue;
    end++;
    bool a = buffer[end] == 0 && buffer[end + 1] == 1 && buffer[end + 2] == 0 &&
             buffer[end + 3] == 1;
    end += 4;
    buffer[2] = 0x81;
    buffer[3] = 0x80;
    buffer[6] = 0;
    buffer[7] = a ? 1 : 0;
    buffer[8] = buffer[9] = buffer[10] = buffer[11] = 0;
    if (a) {
      const unsigned char answer[] = {0xc0, 0x0c, 0, 1, 0,   1,   0, 0,
                                      0,    60,   0, 4, 192, 168, 4, 1};
      memcpy(buffer + end, answer, sizeof answer);
      end += sizeof answer;
    }
    sendto(socket_fd, buffer, end, 0, (struct sockaddr *)&peer, peer_size);
  }
}
void camera_setup_start(void) {
  if (active)
    return;
  wifi_config_t ap = {0};
  const char *name = "Plant-A Setup";
  memcpy(ap.ap.ssid, name, strlen(name));
  ap.ap.ssid_len = strlen(name);
  ap.ap.channel = 1;
  ap.ap.max_connection = 1;
  ap.ap.authmode = WIFI_AUTH_WPA2_PSK;
  const char alphabet[] =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  unsigned char random[16];
  esp_fill_random(random, sizeof random);
  for (unsigned i = 0; i < 16; i++)
    ap.ap.password[i] = alphabet[random[i] % (sizeof alphabet - 1)];
  esp_fill_random(random, sizeof random);
  if (nonce_lock)
    xSemaphoreTake(nonce_lock, portMAX_DELAY);
  for (unsigned i = 0; i < 16; i++)
    snprintf(csrf + 2 * i, 3, "%02x", random[i]);
  if (nonce_lock)
    xSemaphoreGive(nonce_lock);
  if (esp_wifi_set_mode(WIFI_MODE_APSTA) != ESP_OK ||
      esp_wifi_set_config(WIFI_IF_AP, &ap) != ESP_OK)
    return;
  active = true;
  /* Physical setup output only: this generated temporary AP password is never
   * sent to Cloudlink, embedded in firmware or included in application logs. */
  printf("Plant-A Setup temporary password: %s\nOpen http://192.168.4.1\n",
         (char *)ap.ap.password);
  memset(ap.ap.password, 0, sizeof ap.ap.password);
  if (!dns_started) {
    dns_started = xTaskCreate(dns, "setup-dns", 4096, NULL, 2, NULL) == pdPASS;
  }
}
void camera_setup_stop(void) {
  if (active) {
    active = false;
    if (nonce_lock)
      xSemaphoreTake(nonce_lock, portMAX_DELAY);
    memset(csrf, 0, sizeof csrf);
    if (nonce_lock)
      xSemaphoreGive(nonce_lock);
    esp_wifi_set_mode(WIFI_MODE_STA);
  }
}
void camera_setup_routes(httpd_handle_t server) {
  nonce_lock = xSemaphoreCreateMutex();
  if (!nonce_lock)
    return;
  httpd_uri_t root = {.uri = "/", .method = HTTP_GET, .handler = page},
              setup = {.uri = "/setup", .method = HTTP_GET, .handler = page},
              post = {.uri = "/setup", .method = HTTP_POST, .handler = save},
              android = {.uri = "/generate_204",
                         .method = HTTP_GET,
                         .handler = page},
              apple = {.uri = "/hotspot-detect.html",
                       .method = HTTP_GET,
                       .handler = page};
  httpd_register_uri_handler(server, &root);
  httpd_register_uri_handler(server, &setup);
  httpd_register_uri_handler(server, &post);
  httpd_register_uri_handler(server, &android);
  httpd_register_uri_handler(server, &apple);
}
