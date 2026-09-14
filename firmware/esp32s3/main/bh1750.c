/* hsx-driver-bh1750@0.1.0. Continuous H-resolution mode, MTreg default69.
 * ROHM BH1750FVI datasheet: command0x10; 120ms typical/180ms max;
 * illuminance = unsigned16-bit measurement /1.2. No fabricated fallback. */
#include "bh1750.h"
#include "driver/i2c.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#define BUS I2C_NUM_0
#define ADDRESS 0x23
esp_err_t bh1750_init(int sda, int scl) {
  i2c_config_t cfg = {.mode=I2C_MODE_MASTER,.sda_io_num=sda,.scl_io_num=scl,
    .sda_pullup_en=GPIO_PULLUP_ENABLE,.scl_pullup_en=GPIO_PULLUP_ENABLE,
    .master.clk_speed=100000};
  esp_err_t rc=i2c_param_config(BUS,&cfg); if(rc!=ESP_OK)return rc;
  rc=i2c_driver_install(BUS,I2C_MODE_MASTER,0,0,0);if(rc!=ESP_OK)return rc;
  const unsigned char mode=0x10;
  rc=i2c_master_write_to_device(BUS,ADDRESS,&mode,1,pdMS_TO_TICKS(1000));
  vTaskDelay(pdMS_TO_TICKS(180));return rc;
}
esp_err_t bh1750_read(float *lux) {
  unsigned char data[2];
  esp_err_t rc=i2c_master_read_from_device(BUS,ADDRESS,data,2,pdMS_TO_TICKS(1000));
  if(rc==ESP_OK)*lux=((unsigned)data[0]*256+data[1])/1.2f;
  return rc;
}
