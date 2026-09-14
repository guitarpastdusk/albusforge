#include "telemetry-packet.h"
#include <assert.h>
#include <math.h>
#include <string.h>

int main(void) {
  const char *device = "11111111-1111-4111-8111-111111111111";
  char packet[1024];
  unsigned count = 0;
  plant_sensor_reading all = {.light_ok = true, .climate_ok = true,
    .light_lux = 577.6f, .temperature_c = 25.3f, .pressure_hpa = 1004.6f,
    .humidity_pct = 56.3f};
  assert(telemetry_packet_encode(packet, sizeof packet, device, 7, 1800000000,
                                 12, -58, &all, &count) > 0);
  assert(count == 4);
  assert(strstr(packet, "ambient_light_lux") && strstr(packet, "air_temperature_c") &&
         strstr(packet, "air_pressure_hpa") && strstr(packet, "air_humidity_pct"));
  assert(!strstr(packet, "soil"));
  plant_sensor_reading partial = {.light_ok = true, .light_lux = 1};
  assert(telemetry_packet_encode(packet, sizeof packet, device, 8, 1800000001,
                                 13, -57, &partial, &count) > 0);
  assert(count == 1 && strstr(packet, "climate_unavailable"));
  assert(telemetry_packet_encode(packet, sizeof packet, device, 9, 1800000002,
                                 14, -57, &(plant_sensor_reading){0}, &count) < 0);
  all.humidity_pct = NAN;
  assert(telemetry_packet_encode(packet, sizeof packet, device, 9, 1800000002,
                                 14, -57, &all, &count) < 0);
  assert(telemetry_packet_encode(packet, sizeof packet, "bad", 9, 1800000002,
                                 14, -57, &partial, &count) < 0);
}
