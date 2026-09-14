/* hsx-driver-bme280@0.1.0. Bosch BME280 datasheet rev 1.6: forced mode, 1x
 * oversampling on all three quantities, and the datasheet's own fixed-point
 * compensation (sections 4.2.2 and 8.2). Calibration is read from the part;
 * nothing here is modelled or defaulted. A failed conversion returns an error
 * and the sample is skipped, never replaced with a plausible number. */
#include "bme280.h"
#include "hsx-i2c.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdint.h>
#define CHIP_ID 0x60
#define REG_ID 0xD0
#define REG_RESET 0xE0
#define REG_CALIB_LOW 0x88
#define REG_CALIB_H1 0xA1
#define REG_CALIB_HIGH 0xE1
#define REG_CTRL_HUM 0xF2
#define REG_STATUS 0xF3
#define REG_CTRL_MEAS 0xF4
#define REG_CONFIG 0xF5
#define REG_DATA 0xF7
static uint8_t address;
static uint16_t dig_T1, dig_P1;
static int16_t dig_T2, dig_T3, dig_P2, dig_P3, dig_P4, dig_P5, dig_P6, dig_P7, dig_P8, dig_P9;
static uint8_t dig_H1, dig_H3;
static int16_t dig_H2, dig_H4, dig_H5;
static int8_t dig_H6;
static int32_t t_fine;
static uint16_t u16(const uint8_t *b) { return (uint16_t)((uint16_t)b[1] << 8 | b[0]); }
static int16_t s16(const uint8_t *b) { return (int16_t)u16(b); }
esp_err_t bme280_init(void) {
  uint8_t id = 0;
  static const uint8_t candidates[2] = {0x77, 0x76};
  esp_err_t rc = ESP_ERR_NOT_FOUND;
  address = 0;
  for (size_t i = 0; i < sizeof candidates; i++) {
    rc = hsx_i2c_read_register(candidates[i], REG_ID, &id, 1);
    /* 0x58 is a BMP280: no humidity, so it is not this part and is refused. */
    if (rc == ESP_OK && id == CHIP_ID) { address = candidates[i]; break; }
    rc = ESP_ERR_NOT_FOUND;
  }
  if (rc != ESP_OK) return rc;
  rc = hsx_i2c_write_register(address, REG_RESET, 0xB6);
  if (rc != ESP_OK) return rc;
  vTaskDelay(pdMS_TO_TICKS(10));
  uint8_t low[26], high[7];
  rc = hsx_i2c_read_register(address, REG_CALIB_LOW, low, sizeof low);
  if (rc != ESP_OK) return rc;
  rc = hsx_i2c_read_register(address, REG_CALIB_HIGH, high, sizeof high);
  if (rc != ESP_OK) return rc;
  dig_T1 = u16(low); dig_T2 = s16(low + 2); dig_T3 = s16(low + 4);
  dig_P1 = u16(low + 6); dig_P2 = s16(low + 8); dig_P3 = s16(low + 10);
  dig_P4 = s16(low + 12); dig_P5 = s16(low + 14); dig_P6 = s16(low + 16);
  dig_P7 = s16(low + 18); dig_P8 = s16(low + 20); dig_P9 = s16(low + 22);
  rc = hsx_i2c_read_register(address, REG_CALIB_H1, &dig_H1, 1);
  if (rc != ESP_OK) return rc;
  dig_H2 = s16(high);
  dig_H3 = high[2];
  dig_H4 = (int16_t)(((int16_t)(int8_t)high[3] << 4) | (high[4] & 0x0F));
  dig_H5 = (int16_t)(((int16_t)(int8_t)high[5] << 4) | (high[4] >> 4));
  dig_H6 = (int8_t)high[6];
  if (dig_T1 == 0 || dig_P1 == 0) return ESP_ERR_INVALID_RESPONSE;
  rc = hsx_i2c_write_register(address, REG_CONFIG, 0x00);
  if (rc != ESP_OK) return rc;
  /* osrs_h = 1x. ctrl_hum only takes effect on the next ctrl_meas write. */
  return hsx_i2c_write_register(address, REG_CTRL_HUM, 0x01);
}
static int32_t compensate_t(int32_t adc_T) {
  int32_t var1 = ((((adc_T >> 3) - ((int32_t)dig_T1 << 1)) * (int32_t)dig_T2) >> 11);
  int32_t var2 = (((((adc_T >> 4) - (int32_t)dig_T1) * ((adc_T >> 4) - (int32_t)dig_T1)) >> 12) * (int32_t)dig_T3) >> 14;
  t_fine = var1 + var2;
  return (t_fine * 5 + 128) >> 8; /* 0.01 degC */
}
static uint32_t compensate_p(int32_t adc_P) {
  int64_t var1 = (int64_t)t_fine - 128000;
  int64_t var2 = var1 * var1 * (int64_t)dig_P6;
  var2 = var2 + ((var1 * (int64_t)dig_P5) << 17);
  var2 = var2 + (((int64_t)dig_P4) << 35);
  var1 = ((var1 * var1 * (int64_t)dig_P3) >> 8) + ((var1 * (int64_t)dig_P2) << 12);
  var1 = (((((int64_t)1) << 47) + var1)) * (int64_t)dig_P1 >> 33;
  if (var1 == 0) return 0;
  int64_t p = 1048576 - adc_P;
  p = (((p << 31) - var2) * 3125) / var1;
  var1 = (((int64_t)dig_P9) * (p >> 13) * (p >> 13)) >> 25;
  var2 = (((int64_t)dig_P8) * p) >> 19;
  p = ((p + var1 + var2) >> 8) + (((int64_t)dig_P7) << 4);
  return (uint32_t)p; /* Pa in Q24.8 */
}
static uint32_t compensate_h(int32_t adc_H) {
  int32_t v = t_fine - (int32_t)76800;
  int32_t left = ((adc_H << 14) - (((int32_t)dig_H4) << 20) - (((int32_t)dig_H5) * v) + (int32_t)16384) >> 15;
  int32_t right = (((((v * (int32_t)dig_H6) >> 10) * (((v * (int32_t)dig_H3) >> 11) + (int32_t)32768)) >> 10)
    + (int32_t)2097152) * (int32_t)dig_H2 + 8192;
  v = left * (right >> 14);
  v = v - ((((v >> 15) * (v >> 15)) >> 7) * (int32_t)dig_H1 >> 4);
  if (v < 0) v = 0;
  if (v > 419430400) v = 419430400;
  return (uint32_t)(v >> 12); /* %RH in Q22.10 */
}
esp_err_t bme280_read(float *temperature_c, float *humidity_pct, float *pressure_hpa) {
  if (!address) return ESP_ERR_INVALID_STATE;
  /* Forced mode, 1x temperature and pressure oversampling. */
  esp_err_t rc = hsx_i2c_write_register(address, REG_CTRL_MEAS, (1 << 5) | (1 << 2) | 1);
  if (rc != ESP_OK) return rc;
  for (int attempt = 0; attempt < 20; attempt++) {
    vTaskDelay(pdMS_TO_TICKS(10));
    uint8_t status = 0;
    rc = hsx_i2c_read_register(address, REG_STATUS, &status, 1);
    if (rc != ESP_OK) return rc;
    if (!(status & 0x08)) break;
    if (attempt == 19) return ESP_ERR_TIMEOUT;
  }
  uint8_t data[8];
  rc = hsx_i2c_read_register(address, REG_DATA, data, sizeof data);
  if (rc != ESP_OK) return rc;
  int32_t adc_P = (int32_t)(((uint32_t)data[0] << 12) | ((uint32_t)data[1] << 4) | (data[2] >> 4));
  int32_t adc_T = (int32_t)(((uint32_t)data[3] << 12) | ((uint32_t)data[4] << 4) | (data[5] >> 4));
  int32_t adc_H = (int32_t)(((uint32_t)data[6] << 8) | data[7]);
  /* 0x80000/0x8000 are the datasheet's "measurement skipped" sentinels. */
  if (adc_T == 0x80000 || adc_P == 0x80000 || adc_H == 0x8000) return ESP_ERR_INVALID_RESPONSE;
  *temperature_c = (float)compensate_t(adc_T) / 100.0f;
  uint32_t pressure = compensate_p(adc_P);
  if (!pressure) return ESP_ERR_INVALID_RESPONSE;
  *pressure_hpa = (float)pressure / 25600.0f; /* Q24.8 Pa -> hPa */
  *humidity_pct = (float)compensate_h(adc_H) / 1024.0f;
  return ESP_OK;
}
