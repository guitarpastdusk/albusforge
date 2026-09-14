#pragma once
#include "esp_err.h"
#include "hsx-wire.h"
#include <stddef.h>
/** The sensor set enabled for this build, selected by the HSX_SENSOR_* macros
 * the compiler writes into hsx-profile.h from the accepted plan's peripherals. */
esp_err_t hsx_sensors_init(void);
/** One sample of every enabled sensor. Any failure fails the whole sample:
 * a partial or out-of-range packet is never sent. */
esp_err_t hsx_sensors_read(hsx_reading_t *readings, size_t capacity, size_t *count);
