#include "plant-sensors.h"

#include "driver/i2c.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <math.h>
#include <string.h>

#define SENSOR_BUS I2C_NUM_0
#define SENSOR_SDA GPIO_NUM_47
#define SENSOR_SCL GPIO_NUM_21
#define BH1750_ADDRESS 0x23
#define BME280_ADDRESS 0x77

typedef struct {
  uint16_t t1;
  int16_t t2, t3;
  uint16_t p1;
  int16_t p2, p3, p4, p5, p6, p7, p8, p9;
  uint8_t h1, h3;
  int16_t h2, h4, h5;
  int8_t h6;
} bme280_calibration;

static bme280_calibration calibration;
static bool bus_ready, ready;

static uint16_t u16(const uint8_t *v) { return (uint16_t)v[0] | ((uint16_t)v[1] << 8); }
static int16_t s16(const uint8_t *v) { return (int16_t)u16(v); }
static int16_t s12(uint16_t value) {
  return value & 0x0800 ? (int16_t)(value | 0xf000) : (int16_t)value;
}
static esp_err_t write_register(uint8_t address, uint8_t reg, uint8_t value) {
  uint8_t bytes[] = {reg, value};
  return i2c_master_write_to_device(SENSOR_BUS, address, bytes, sizeof bytes,
                                    pdMS_TO_TICKS(1000));
}
static esp_err_t read_registers(uint8_t address, uint8_t reg, uint8_t *bytes,
                                size_t count) {
  return i2c_master_write_read_device(SENSOR_BUS, address, &reg, 1, bytes,
                                      count, pdMS_TO_TICKS(1000));
}

static esp_err_t bme280_init(void) {
  uint8_t id;
  if (read_registers(BME280_ADDRESS, 0xd0, &id, 1) != ESP_OK || id != 0x60)
    return ESP_FAIL;
  if (write_register(BME280_ADDRESS, 0xe0, 0xb6) != ESP_OK)
    return ESP_FAIL;
  vTaskDelay(pdMS_TO_TICKS(4));
  uint8_t a[26], b[7];
  if (read_registers(BME280_ADDRESS, 0x88, a, sizeof a) != ESP_OK ||
      read_registers(BME280_ADDRESS, 0xe1, b, sizeof b) != ESP_OK)
    return ESP_FAIL;
  calibration = (bme280_calibration){
      .t1 = u16(a), .t2 = s16(a + 2), .t3 = s16(a + 4), .p1 = u16(a + 6),
      .p2 = s16(a + 8), .p3 = s16(a + 10), .p4 = s16(a + 12),
      .p5 = s16(a + 14), .p6 = s16(a + 16), .p7 = s16(a + 18),
      .p8 = s16(a + 20), .p9 = s16(a + 22), .h1 = a[25], .h2 = s16(b),
      .h3 = b[2], .h4 = s12((uint16_t)(b[3] << 4) | (b[4] & 0x0f)),
      .h5 = s12((uint16_t)(b[5] << 4) | (b[4] >> 4)), .h6 = (int8_t)b[6]};
  if (!calibration.t1 || !calibration.p1)
    return ESP_FAIL;
  return write_register(BME280_ADDRESS, 0xf2, 0x01) == ESP_OK &&
                 write_register(BME280_ADDRESS, 0xf5, 0xa0) == ESP_OK &&
                 write_register(BME280_ADDRESS, 0xf4, 0x27) == ESP_OK
             ? ESP_OK
             : ESP_FAIL;
}

static esp_err_t bme280_read(float *temperature, float *pressure,
                             float *humidity) {
  uint8_t raw[8];
  if (read_registers(BME280_ADDRESS, 0xf7, raw, sizeof raw) != ESP_OK)
    return ESP_FAIL;
  int32_t adc_p = ((int32_t)raw[0] << 12) | ((int32_t)raw[1] << 4) | (raw[2] >> 4);
  int32_t adc_t = ((int32_t)raw[3] << 12) | ((int32_t)raw[4] << 4) | (raw[5] >> 4);
  int32_t adc_h = ((int32_t)raw[6] << 8) | raw[7];
  int32_t x1 = ((((adc_t >> 3) - ((int32_t)calibration.t1 << 1))) *
                (int32_t)calibration.t2) >> 11;
  int32_t x2 = (((((adc_t >> 4) - (int32_t)calibration.t1) *
                  ((adc_t >> 4) - (int32_t)calibration.t1)) >> 12) *
                (int32_t)calibration.t3) >> 14;
  int32_t fine = x1 + x2;
  int32_t centi_c = (fine * 5 + 128) >> 8;
  int64_t var1 = (int64_t)fine - 128000;
  int64_t var2 = var1 * var1 * calibration.p6;
  var2 += (var1 * calibration.p5) << 17;
  var2 += ((int64_t)calibration.p4) << 35;
  var1 = ((var1 * var1 * calibration.p3) >> 8) + ((var1 * calibration.p2) << 12);
  var1 = (((((int64_t)1) << 47) + var1) * calibration.p1) >> 33;
  if (!var1)
    return ESP_FAIL;
  int64_t p = 1048576 - adc_p;
  p = (((p << 31) - var2) * 3125) / var1;
  var1 = ((int64_t)calibration.p9 * (p >> 13) * (p >> 13)) >> 25;
  var2 = ((int64_t)calibration.p8 * p) >> 19;
  p = ((p + var1 + var2) >> 8) + ((int64_t)calibration.p7 << 4);
  int32_t h = fine - 76800;
  h = (((((adc_h << 14) - ((int32_t)calibration.h4 << 20) -
          ((int32_t)calibration.h5 * h)) + 16384) >> 15) *
       (((((((h * calibration.h6) >> 10) * (((h * calibration.h3) >> 11) +
          32768)) >> 10) + 2097152) * calibration.h2 + 8192) >> 14));
  h -= (((((h >> 15) * (h >> 15)) >> 7) * calibration.h1) >> 4);
  if (h < 0) h = 0;
  if (h > 419430400) h = 419430400;
  *temperature = centi_c / 100.0f;
  *pressure = (float)p / 25600.0f;
  *humidity = (float)(h >> 12) / 1024.0f;
  return isfinite(*temperature) && isfinite(*pressure) && isfinite(*humidity)
             ? ESP_OK
             : ESP_FAIL;
}

esp_err_t plant_sensors_init(void) {
  if (!bus_ready) {
    i2c_config_t bus = {.mode = I2C_MODE_MASTER,
                        .sda_io_num = SENSOR_SDA,
                        .scl_io_num = SENSOR_SCL,
                        .sda_pullup_en = GPIO_PULLUP_ENABLE,
                        .scl_pullup_en = GPIO_PULLUP_ENABLE,
                        .master.clk_speed = 100000};
    if (i2c_param_config(SENSOR_BUS, &bus) != ESP_OK ||
        i2c_driver_install(SENSOR_BUS, I2C_MODE_MASTER, 0, 0, 0) != ESP_OK)
      return ESP_FAIL;
    bus_ready = true;
  }
  uint8_t mode = 0x10;
  if (i2c_master_write_to_device(SENSOR_BUS, BH1750_ADDRESS, &mode, 1,
                                 pdMS_TO_TICKS(1000)) != ESP_OK ||
      bme280_init() != ESP_OK)
    return ESP_FAIL;
  vTaskDelay(pdMS_TO_TICKS(180));
  ready = true;
  return ESP_OK;
}

esp_err_t plant_sensors_read(plant_sensor_reading *reading) {
  if (!ready || !reading)
    return ESP_ERR_INVALID_STATE;
  *reading = (plant_sensor_reading){0};
  uint8_t light[2];
  if (i2c_master_read_from_device(SENSOR_BUS, BH1750_ADDRESS, light,
                                  sizeof light, pdMS_TO_TICKS(1000)) == ESP_OK) {
    reading->light_lux = ((uint16_t)light[0] * 256 + light[1]) / 1.2f;
    reading->light_ok = isfinite(reading->light_lux) && reading->light_lux >= 0 &&
                        reading->light_lux <= 65535;
  }
  reading->climate_ok = bme280_read(&reading->temperature_c,
                                    &reading->pressure_hpa,
                                    &reading->humidity_pct) == ESP_OK &&
                        reading->temperature_c >= -40 && reading->temperature_c <= 85 &&
                        reading->pressure_hpa >= 300 && reading->pressure_hpa <= 1100 &&
                        reading->humidity_pct >= 0 && reading->humidity_pct <= 100;
  return reading->light_ok || reading->climate_ok ? ESP_OK : ESP_FAIL;
}
