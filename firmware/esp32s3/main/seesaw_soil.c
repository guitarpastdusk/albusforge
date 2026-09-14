/* hsx-driver-seesaw-soil@0.1.0. Adafruit STEMMA capacitive soil sensor
 * (product 4026), an ATSAMD10 running seesaw firmware at address 0x36.
 * Protocol per the Adafruit seesaw guide: write [base, function], wait, then
 * read the reply. Touch base 0x0F / channel 0x10 returns a 16-bit capacitance
 * count; there is no factory calibration, so the raw count is published as-is
 * and any percentage mapping is left to the cloud. UNVERIFIED ON HARDWARE. */
#include "seesaw-soil.h"
#include "hsx-i2c.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdint.h>
#define ADDRESS 0x36
#define STATUS_BASE 0x00
#define STATUS_HW_ID 0x01
#define STATUS_RESET 0x7F
#define TOUCH_BASE 0x0F
#define TOUCH_CHANNEL 0x10
#define COUNT_MAX 4095
static bool ready;
esp_err_t seesaw_soil_init(void) {
  ready = false;
  const uint8_t reset[3] = {STATUS_BASE, STATUS_RESET, 0xFF};
  esp_err_t rc = hsx_i2c_write(ADDRESS, reset, sizeof reset);
  if (rc != ESP_OK) return rc;
  vTaskDelay(pdMS_TO_TICKS(500));
  const uint8_t query[2] = {STATUS_BASE, STATUS_HW_ID};
  rc = hsx_i2c_write(ADDRESS, query, sizeof query);
  if (rc != ESP_OK) return rc;
  vTaskDelay(pdMS_TO_TICKS(10));
  uint8_t id = 0;
  rc = hsx_i2c_read(ADDRESS, &id, 1);
  if (rc != ESP_OK) return rc;
  /* 0x55 SAMD09, 0x84/0x86 ATtiny8x reworks of the same board. An unknown
   * hardware id is refused rather than read speculatively. */
  if (id != 0x55 && id != 0x84 && id != 0x86) return ESP_ERR_NOT_FOUND;
  ready = true;
  return ESP_OK;
}
esp_err_t seesaw_soil_read(float *moisture_raw) {
  if (!ready) return ESP_ERR_INVALID_STATE;
  const uint8_t query[2] = {TOUCH_BASE, TOUCH_CHANNEL};
  /* seesaw needs settle time between the request and the reply, and reports
   * an out-of-range count when read too early; retry rather than publish it. */
  for (int attempt = 0; attempt < 4; attempt++) {
    esp_err_t rc = hsx_i2c_write(ADDRESS, query, sizeof query);
    if (rc != ESP_OK) return rc;
    vTaskDelay(pdMS_TO_TICKS(20));
    uint8_t data[2] = {0, 0};
    rc = hsx_i2c_read(ADDRESS, data, sizeof data);
    if (rc != ESP_OK) return rc;
    unsigned count = (unsigned)data[0] * 256u + data[1];
    if (count <= COUNT_MAX) { *moisture_raw = (float)count; return ESP_OK; }
  }
  return ESP_ERR_INVALID_RESPONSE;
}
