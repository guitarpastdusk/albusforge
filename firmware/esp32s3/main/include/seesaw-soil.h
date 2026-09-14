#pragma once
#include "esp_err.h"
/** hsx-driver-seesaw-soil@0.1.0, Adafruit STEMMA soil sensor at 0x36.
 * Requires hsx_i2c_init first. Returns the raw capacitive touch count. */
esp_err_t seesaw_soil_init(void);
esp_err_t seesaw_soil_read(float *moisture_raw);
