#pragma once
#include <stdbool.h>
bool setup_wifi_valid(const char *ssid, const char *password);
bool setup_form_parse(const char *body, const char *csrf, char ssid[33],
                      char password[64]);

bool setup_host_allowed(const char *host);
bool setup_origin_allowed(const char *origin);
