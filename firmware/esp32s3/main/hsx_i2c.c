/* Shared I2C master. The SDA/SCL pins come from the compiler-generated
 * hsx-profile.h, which carries the accepted assembly profile's port resources. */
#include "hsx-i2c.h"
#include "driver/i2c.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#define BUS I2C_NUM_0
#define TIMEOUT pdMS_TO_TICKS(1000)
static bool installed;
esp_err_t hsx_i2c_init(int sda, int scl) {
  if (installed) return ESP_OK;
  i2c_config_t cfg = {.mode = I2C_MODE_MASTER, .sda_io_num = sda, .scl_io_num = scl,
    .sda_pullup_en = GPIO_PULLUP_ENABLE, .scl_pullup_en = GPIO_PULLUP_ENABLE,
    .master.clk_speed = 100000};
  esp_err_t rc = i2c_param_config(BUS, &cfg);
  if (rc != ESP_OK) return rc;
  rc = i2c_driver_install(BUS, I2C_MODE_MASTER, 0, 0, 0);
  if (rc == ESP_OK) installed = true;
  return rc;
}
esp_err_t hsx_i2c_write(uint8_t address, const uint8_t *bytes, size_t length) {
  return i2c_master_write_to_device(BUS, address, bytes, length, TIMEOUT);
}
esp_err_t hsx_i2c_read(uint8_t address, uint8_t *bytes, size_t length) {
  return i2c_master_read_from_device(BUS, address, bytes, length, TIMEOUT);
}
esp_err_t hsx_i2c_read_register(uint8_t address, uint8_t reg, uint8_t *bytes, size_t length) {
  return i2c_master_write_read_device(BUS, address, &reg, 1, bytes, length, TIMEOUT);
}
esp_err_t hsx_i2c_write_register(uint8_t address, uint8_t reg, uint8_t value) {
  const uint8_t payload[2] = {reg, value};
  return hsx_i2c_write(address, payload, sizeof payload);
}
