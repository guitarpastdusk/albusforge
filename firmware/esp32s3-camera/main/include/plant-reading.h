#pragma once

#include <stdbool.h>

typedef struct {
  bool light_ok;
  bool climate_ok;
  float light_lux;
  float temperature_c;
  float pressure_hpa;
  float humidity_pct;
} plant_sensor_reading;
