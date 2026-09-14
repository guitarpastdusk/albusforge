/* hsx-driver-bh1750@0.1.0. Continuous H-resolution mode, MTreg default69.
 * ROHM BH1750FVI datasheet: command0x10; 120ms typical/180ms max;
 * illuminance = unsigned16-bit measurement /1.2. No fabricated fallback. */
#include "bh1750.h"
#include "hsx-i2c.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#define ADDRESS 0x23
esp_err_t bh1750_init(void) {
  const unsigned char mode = 0x10;
  esp_err_t rc = hsx_i2c_write(ADDRESS, &mode, 1);
  vTaskDelay(pdMS_TO_TICKS(180));
  return rc;
}
esp_err_t bh1750_read(float *lux) {
  unsigned char data[2];
  esp_err_t rc = hsx_i2c_read(ADDRESS, data, 2);
  if (rc == ESP_OK) *lux = ((unsigned)data[0] * 256 + data[1]) / 1.2f;
  return rc;
}
