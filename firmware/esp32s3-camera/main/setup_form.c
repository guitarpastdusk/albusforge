#include "setup-form.h"
#include <string.h>
static int hex(char c) {
  if (c >= '0' && c <= '9')
    return c - '0';
  if (c >= 'a' && c <= 'f')
    return c - 'a' + 10;
  if (c >= 'A' && c <= 'F')
    return c - 'A' + 10;
  return -1;
}
static bool decode(const char *input, size_t length, char *out, size_t size) {
  size_t n = 0;
  for (size_t i = 0; i < length; i++) {
    unsigned char c = input[i];
    if (c == '+')
      c = ' ';
    else if (c == '%') {
      if (i + 2 >= length || hex(input[i + 1]) < 0 || hex(input[i + 2]) < 0)
        return false;
      c = hex(input[i + 1]) * 16 + hex(input[i + 2]);
      i += 2;
    }
    if (c == 0 || n + 1 >= size)
      return false;
    out[n++] = c;
  }
  out[n] = 0;
  return true;
}
static bool parameter(const char *body, const char *name, char *out,
                      size_t size) {
  bool found = false;
  size_t key = strlen(name);
  const char *p = body;
  while (*p) {
    const char *end = strchr(p, '&');
    if (!end)
      end = p + strlen(p);
    if ((size_t)(end - p) > key && p[key] == '=' && !memcmp(p, name, key)) {
      if (found || !decode(p + key + 1, end - p - key - 1, out, size))
        return false;
      found = true;
    }
    p = *end ? end + 1 : end;
  }
  return found;
}

bool setup_wifi_valid(const char *ssid, const char *password) {
  return ssid && password && strlen(ssid) > 0 && strlen(ssid) <= 32 &&
         strlen(password) >= 8 && strlen(password) <= 63;
}
bool setup_form_parse(const char *body, const char *csrf, char ssid[33],
                      char password[64]) {
  char nonce[33];
  return body && csrf && strlen(body) <= 512 &&
         parameter(body, "csrf", nonce, sizeof nonce) && !strcmp(nonce, csrf) &&
         parameter(body, "ssid", ssid, 33) &&
         parameter(body, "password", password, 64) &&
         setup_wifi_valid(ssid, password);
}

bool setup_host_allowed(const char *host) {
  return host &&
         (!strcmp(host, "192.168.4.1") || !strcmp(host, "192.168.4.1:80"));
}
bool setup_origin_allowed(const char *origin) {
  return !origin || !strcmp(origin, "http://192.168.4.1") ||
         !strcmp(origin, "http://192.168.4.1:80");
}
