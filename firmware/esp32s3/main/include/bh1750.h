#pragma once
#include "esp_err.h"
esp_err_t bh1750_init(int sda, int scl);
esp_err_t bh1750_read(float *lux);
