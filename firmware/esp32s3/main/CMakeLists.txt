idf_component_register(SRCS "app.cpp" "hsx_sdk.c" "bh1750.c" "hsx_wire.c" INCLUDE_DIRS "include" REQUIRES esp_wifi esp_event esp_netif nvs_flash esp_http_client esp_timer json driver mbedtls)
