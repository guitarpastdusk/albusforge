#pragma once
#include "esp_err.h"
/** hsx-driver-bh1750@0.1.0, address 0x23. Requires hsx_i2c_init first. */
esp_err_t bh1750_init(void);
esp_err_t bh1750_read(float *lux);
