#pragma once
#include "cJSON.h"
#include "esp_http_server.h"
#include <stdbool.h>
/* Credentials stay in albus_cfg; setup is served only on the AP interface. */
bool camera_wifi_configure(cJSON *config);
void camera_setup_routes(httpd_handle_t server);
void camera_setup_start(void);
void camera_setup_stop(void);
