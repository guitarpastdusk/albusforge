/* Credential-free runtime. Provisioning and Wi-Fi arrive only through albus_cfg.
 * Never log config, authentication headers, SSIDs or packet bodies. */
#include "hsx-sdk.h"
#include "hsx-profile.h"
#include "hsx-wire.h"
#include "bh1750.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "nvs_flash.h"
static EventGroupHandle_t connected;
static void fail_closed(void) { for (;;) vTaskDelay(pdMS_TO_TICKS(60000)); }
static const char *string(cJSON *json,const char *key,size_t max) {
  cJSON *v=cJSON_GetObjectItemCaseSensitive(json,key);
  return cJSON_IsString(v)&&strlen(v->valuestring)>0&&strlen(v->valuestring)<=max?v->valuestring:NULL;
}
static void wifi_event(void *arg,esp_event_base_t base,int32_t id,void *data) {
  (void)arg;(void)data;
  if(base==IP_EVENT&&id==IP_EVENT_STA_GOT_IP)xEventGroupSetBits(connected,BIT0);
  if(base==WIFI_EVENT&&id==WIFI_EVENT_STA_DISCONNECTED) {
    xEventGroupClearBits(connected,BIT0);esp_wifi_connect();
  }
  if(base==WIFI_EVENT&&id==WIFI_EVENT_STA_START)esp_wifi_connect();
}
static char *nvs_string(nvs_handle_t store,const char *key,size_t max) {
  size_t size=0;if(nvs_get_str(store,key,NULL,&size)!=ESP_OK||size>max)return NULL;
  char *s=malloc(size);if(!s)return NULL;
  if(nvs_get_str(store,key,s,&size)!=ESP_OK){free(s);return NULL;}return s;
}
void hsx_run(unsigned interval_s) {
  if(interval_s<10||interval_s>86400)fail_closed();
  nvs_handle_t store;
  if(nvs_flash_init_partition("albus_cfg")!=ESP_OK||nvs_open_from_partition("albus_cfg","albus",NVS_READWRITE,&store)!=ESP_OK)fail_closed();
  char *raw=nvs_string(store,"config",8192);if(!raw)fail_closed();
  cJSON *cfg=cJSON_Parse(raw);free(raw);if(!cfg)fail_closed();
  const char *dev=string(cfg,"device_id",36),*token=string(cfg,"token",43),*url=string(cfg,"ingest_url",256);
  const char *profile=string(cfg,"profile_id",120),*runtime=string(cfg,"runtime",30);
  const char *ssid=string(cfg,"wifi_ssid",32),*password=string(cfg,"wifi_password",63);
  cJSON *start=cJSON_GetObjectItemCaseSensitive(cfg,"seq_start");
  if(!dev||strlen(dev)!=36||!token||strlen(token)!=43||!url||strncmp(url,"https://",8)||!profile||strcmp(profile,HSX_PROFILE_ID)||!runtime||strcmp(runtime,HSX_RUNTIME)||!ssid||!password||!cJSON_IsNumber(start)||start->valuedouble<0||start->valuedouble>9007199254740990.0||floor(start->valuedouble)!=start->valuedouble)fail_closed();
  uint64_t seq=(uint64_t)start->valuedouble;
  char *saved=nvs_string(store,"state",4096);
  cJSON *state=saved?cJSON_Parse(saved):cJSON_CreateObject();free(saved);
  if(!state)fail_closed();
  cJSON *saved_seq=cJSON_GetObjectItemCaseSensitive(state,"next_seq");
  if(saved_seq) {if(!cJSON_IsNumber(saved_seq)||saved_seq->valuedouble<seq||saved_seq->valuedouble>9007199254740991.0)fail_closed();seq=(uint64_t)saved_seq->valuedouble;}
  connected=xEventGroupCreate();if(!connected)fail_closed();
  ESP_ERROR_CHECK(esp_netif_init());ESP_ERROR_CHECK(esp_event_loop_create_default());esp_netif_create_default_wifi_sta();
  wifi_init_config_t wi=WIFI_INIT_CONFIG_DEFAULT();wi.nvs_enable=0;
  ESP_ERROR_CHECK(esp_wifi_init(&wi));ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
  ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,NULL));
  ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_event,NULL));
  wifi_config_t wc={0};memcpy(wc.sta.ssid,ssid,strlen(ssid));memcpy(wc.sta.password,password,strlen(password));wc.sta.threshold.authmode=WIFI_AUTH_WPA2_PSK;
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&wc));ESP_ERROR_CHECK(esp_wifi_start());
  xEventGroupWaitBits(connected,BIT0,pdFALSE,pdTRUE,portMAX_DELAY);
  esp_sntp_config_t ntp=ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");ESP_ERROR_CHECK(esp_netif_sntp_init(&ntp));
  while(esp_netif_sntp_sync_wait(pdMS_TO_TICKS(30000))!=ESP_OK)vTaskDelay(pdMS_TO_TICKS(1000));
  if(bh1750_init(HSX_SDA,HSX_SCL)!=ESP_OK)fail_closed();
  char authorization[51];snprintf(authorization,sizeof authorization,"Bearer %s",token);
  for(;;) {
    xEventGroupWaitBits(connected,BIT0,pdFALSE,pdTRUE,portMAX_DELAY);
    const char *pending=string(state,"packet",2048);
    char *packet=pending?strdup(pending):NULL;
    if(!packet) {
      float lux;time_t now=time(NULL);
      if(now<1700000000||bh1750_read(&lux)!=ESP_OK||!isfinite(lux)) {vTaskDelay(pdMS_TO_TICKS(1000));continue;}
      if(seq>=9007199254740991ULL)fail_closed();
      packet=malloc(1024);if(!packet||hsx_encode_packet(packet,1024,dev,seq,now,lux,esp_timer_get_time()/1000000)<0)fail_closed();
      // One persisted value binds the reservation to its packet; NVS is not a multi-key transaction.
      cJSON_Delete(state);state=cJSON_CreateObject();
      cJSON_AddStringToObject(state,"packet",packet);cJSON_AddNumberToObject(state,"next_seq",(double)(seq+1));
      char *serialized=cJSON_PrintUnformatted(state);if(!serialized||nvs_set_str(store,"state",serialized)!=ESP_OK||nvs_commit(store)!=ESP_OK)fail_closed();free(serialized);seq++;
    }
    esp_http_client_config_t http={.url=url,.timeout_ms=15000,.crt_bundle_attach=esp_crt_bundle_attach,.disable_auto_redirect=true,.method=HTTP_METHOD_POST};
    esp_http_client_handle_t client=esp_http_client_init(&http);if(!client)fail_closed();
    esp_http_client_set_header(client,"Authorization",authorization);esp_http_client_set_header(client,"Content-Type","application/json");esp_http_client_set_post_field(client,packet,strlen(packet));
    esp_err_t sent=esp_http_client_perform(client);int code=esp_http_client_get_status_code(client);esp_http_client_cleanup(client);free(packet);
    if(sent==ESP_OK&&code==202) {
      cJSON_DeleteItemFromObjectCaseSensitive(state,"packet");
      char *serialized=cJSON_PrintUnformatted(state);if(!serialized||nvs_set_str(store,"state",serialized)!=ESP_OK||nvs_commit(store)!=ESP_OK)fail_closed();free(serialized);
      vTaskDelay(pdMS_TO_TICKS(interval_s*1000));
    } else if(sent==ESP_OK&&(code==400||code==401||code==403||code==409||code==413))fail_closed();
    else vTaskDelay(pdMS_TO_TICKS(10000));
  }
}
