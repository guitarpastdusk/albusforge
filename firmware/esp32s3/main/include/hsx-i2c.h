#pragma once
#include "esp_err.h"
#include <stddef.h>
#include <stdint.h>
/** One shared master bus for every sensor on the assembly's I2C port.
 * Installed exactly once; each driver only talks to its own address. */
esp_err_t hsx_i2c_init(int sda, int scl);
esp_err_t hsx_i2c_write(uint8_t address, const uint8_t *bytes, size_t length);
esp_err_t hsx_i2c_read(uint8_t address, uint8_t *bytes, size_t length);
esp_err_t hsx_i2c_read_register(uint8_t address, uint8_t reg, uint8_t *bytes, size_t length);
esp_err_t hsx_i2c_write_register(uint8_t address, uint8_t reg, uint8_t value);
