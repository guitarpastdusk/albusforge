#pragma once

#include "plant-reading.h"
#include <stddef.h>
#include <stdint.h>

/* Encode only valid, provisioned readings. The caller persists this exact body
 * before sending it, so a retry uses its original sequence and timestamp. */
int telemetry_packet_encode(char *output, size_t capacity, const char *device,
                            uint64_t sequence, int64_t timestamp,
                            uint64_t uptime_s, int rssi,
                            const plant_sensor_reading *reading,
                            unsigned *reading_count);
