/* Binds the enabled drivers to their provisioned channels. Channel keys and
 * ranges come from hsx-channels.h, which apps/codegen mirrors exactly. */
#include "hsx-sensors.h"
#include "hsx-channels.h"
#include "hsx-i2c.h"
#include "hsx-profile.h"
#if HSX_SENSOR_BH1750
#include "bh1750.h"
#endif
#if HSX_SENSOR_BME280
#include "bme280.h"
#endif
#if HSX_SENSOR_SEESAW_SOIL
#include "seesaw-soil.h"
#endif
#include <math.h>
esp_err_t hsx_sensors_init(void) {
  esp_err_t rc = hsx_i2c_init(HSX_SDA, HSX_SCL);
  if (rc != ESP_OK) return rc;
#if HSX_SENSOR_BH1750
  rc = bh1750_init();
  if (rc != ESP_OK) return rc;
#endif
#if HSX_SENSOR_BME280
  rc = bme280_init();
  if (rc != ESP_OK) return rc;
#endif
#if HSX_SENSOR_SEESAW_SOIL
  rc = seesaw_soil_init();
  if (rc != ESP_OK) return rc;
#endif
  return rc;
}
static esp_err_t push(hsx_reading_t *readings, size_t capacity, size_t *count,
                      const char *channel, float value, float min, float max) {
  if (*count >= capacity) return ESP_ERR_NO_MEM;
  /* An implausible value is dropped, not clamped: a clamped number would be
   * indistinguishable from a real reading at the range edge. */
  if (!isfinite(value) || value < min || value > max) return ESP_ERR_INVALID_RESPONSE;
  readings[*count].channel = channel;
  readings[*count].value = value;
  readings[*count].min = min;
  readings[*count].max = max;
  readings[*count].synthetic = 0;
  (*count)++;
  return ESP_OK;
}
esp_err_t hsx_sensors_read(hsx_reading_t *readings, size_t capacity, size_t *count) {
  if (!readings || !count || capacity == 0) return ESP_ERR_INVALID_ARG;
  *count = 0;
  esp_err_t rc = ESP_ERR_NOT_SUPPORTED;
  (void)rc;
#if HSX_SENSOR_BH1750
  {
    float lux = 0;
    rc = bh1750_read(&lux);
    if (rc != ESP_OK) return rc;
    rc = push(readings, capacity, count, HSX_CH_ILLUMINANCE, lux, HSX_MIN_ILLUMINANCE, HSX_MAX_ILLUMINANCE);
    if (rc != ESP_OK) return rc;
  }
#endif
#if HSX_SENSOR_BME280
  {
    float temperature = 0, humidity = 0, pressure = 0;
    rc = bme280_read(&temperature, &humidity, &pressure);
    if (rc != ESP_OK) return rc;
    rc = push(readings, capacity, count, HSX_CH_TEMPERATURE, temperature, HSX_MIN_TEMPERATURE, HSX_MAX_TEMPERATURE);
    if (rc != ESP_OK) return rc;
    rc = push(readings, capacity, count, HSX_CH_HUMIDITY, humidity, HSX_MIN_HUMIDITY, HSX_MAX_HUMIDITY);
    if (rc != ESP_OK) return rc;
    rc = push(readings, capacity, count, HSX_CH_PRESSURE, pressure, HSX_MIN_PRESSURE, HSX_MAX_PRESSURE);
    if (rc != ESP_OK) return rc;
  }
#endif
#if HSX_SENSOR_SEESAW_SOIL
  {
    float moisture = 0;
    rc = seesaw_soil_read(&moisture);
    if (rc != ESP_OK) return rc;
    rc = push(readings, capacity, count, HSX_CH_SOIL_MOISTURE, moisture, HSX_MIN_SOIL_MOISTURE, HSX_MAX_SOIL_MOISTURE);
    if (rc != ESP_OK) return rc;
  }
#endif
  return *count ? ESP_OK : ESP_ERR_INVALID_STATE;
}
