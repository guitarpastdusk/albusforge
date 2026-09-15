#pragma once
#include "esp_err.h"
/** hsx-driver-bme280@0.1.0, address 0x77 with 0x76 fallback (both are the
 * factory options for the same part). Requires hsx_i2c_init first. */
esp_err_t bme280_init(void);
/** One forced-mode conversion: degrees Celsius, percent relative humidity, hectopascal. */
esp_err_t bme280_read(float *temperature_c, float *humidity_pct, float *pressure_hpa);
