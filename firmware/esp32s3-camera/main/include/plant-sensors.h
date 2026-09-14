#pragma once

#include "esp_err.h"
#include "plant-reading.h"

/* The STEMMA QT chain is electrically independent from the camera SCCB bus. */

esp_err_t plant_sensors_init(void);
esp_err_t plant_sensors_read(plant_sensor_reading *reading);
