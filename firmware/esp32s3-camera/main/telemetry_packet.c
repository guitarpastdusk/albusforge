#include "telemetry-packet.h"

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static int uuid_valid(const char *value) {
  if (!value || strlen(value) != 36)
    return 0;
  for (size_t i = 0; i < 36; i++)
    if ((i == 8 || i == 13 || i == 18 || i == 23) ? value[i] != '-'
                                                    : !isxdigit((unsigned char)value[i]))
      return 0;
  return 1;
}
static int append(char *out, size_t cap, size_t *used, const char *channel,
                  float value, int64_t timestamp, unsigned *count) {
  int n = snprintf(out + *used, cap - *used, "%s{\"c\":\"%s\",\"t\":%lld,\"v\":%.6g}",
                   *count ? "," : "", channel, (long long)timestamp, (double)value);
  if (n < 0 || (size_t)n >= cap - *used)
    return -1;
  *used += (size_t)n;
  (*count)++;
  return 0;
}
int telemetry_packet_encode(char *out, size_t cap, const char *device,
                            uint64_t sequence, int64_t timestamp,
                            uint64_t uptime_s, int rssi,
                            const plant_sensor_reading *reading,
                            unsigned *reading_count) {
  if (!out || !cap || !reading || !reading_count || !uuid_valid(device) ||
      sequence > 9007199254740991ULL || timestamp < 1700000000 ||
      timestamp > 253402300799LL || uptime_s > 9007199254740991ULL ||
      (rssi != -151 && (rssi < -150 || rssi > 0)))
    return -1;
  int n = snprintf(out, cap, "{\"v\":1,\"dev\":\"%s\",\"seq\":%llu,\"ts\":%lld,\"r\":[",
                   device, (unsigned long long)sequence, (long long)timestamp);
  if (n < 0 || (size_t)n >= cap)
    return -1;
  size_t used = (size_t)n;
  unsigned count = 0;
  if (reading->light_ok &&
      (!isfinite(reading->light_lux) || reading->light_lux < 0 || reading->light_lux > 65535 ||
       append(out, cap, &used, "ambient_light_lux", reading->light_lux, timestamp, &count)))
    return -1;
  if (reading->climate_ok) {
    if (!isfinite(reading->temperature_c) || !isfinite(reading->pressure_hpa) ||
        !isfinite(reading->humidity_pct) || reading->temperature_c < -40 ||
        reading->temperature_c > 85 || reading->pressure_hpa < 300 ||
        reading->pressure_hpa > 1100 || reading->humidity_pct < 0 ||
        reading->humidity_pct > 100 ||
        append(out, cap, &used, "air_temperature_c", reading->temperature_c, timestamp, &count) ||
        append(out, cap, &used, "air_pressure_hpa", reading->pressure_hpa, timestamp, &count) ||
        append(out, cap, &used, "air_humidity_pct", reading->humidity_pct, timestamp, &count))
      return -1;
  }
  if (!count)
    return -1;
  char signal[24] = {0};
  if (rssi != -151)
    snprintf(signal, sizeof signal, "\"rssi\":%d,", rssi);
  n = snprintf(out + used, cap - used,
               "],\"st\":{%s\"up_s\":%llu,\"health\":[%s%s]}}", signal,
               (unsigned long long)uptime_s,
               reading->light_ok ? "" : "\"light_unavailable\"",
               reading->climate_ok ? "" : (reading->light_ok ? "\"climate_unavailable\"" : ",\"climate_unavailable\""));
  if (n < 0 || (size_t)n >= cap - used)
    return -1;
  *reading_count = count;
  return (int)(used + (size_t)n);
}
