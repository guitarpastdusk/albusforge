#pragma once
/* Single source of truth for wire-v1 numeric channel identity.
 * apps/codegen/src/candidate.ts declares the same key/unit/min/max tuples and
 * apps/codegen/src/firmware-channels.test.ts fails if the two ever diverge.
 * Keys must match ^[a-z][a-z0-9_]{0,63}$ (packages/schema TelemetryChannels). */

#define HSX_CH_ILLUMINANCE "illuminance"
#define HSX_UNIT_ILLUMINANCE "lux"
#define HSX_MIN_ILLUMINANCE 0.0f
#define HSX_MAX_ILLUMINANCE 65535.0f

#define HSX_CH_TEMPERATURE "temperature"
#define HSX_UNIT_TEMPERATURE "degC"
#define HSX_MIN_TEMPERATURE -40.0f
#define HSX_MAX_TEMPERATURE 85.0f

#define HSX_CH_HUMIDITY "humidity"
#define HSX_UNIT_HUMIDITY "%RH"
#define HSX_MIN_HUMIDITY 0.0f
#define HSX_MAX_HUMIDITY 100.0f

#define HSX_CH_PRESSURE "pressure"
#define HSX_UNIT_PRESSURE "hPa"
#define HSX_MIN_PRESSURE 300.0f
#define HSX_MAX_PRESSURE 1100.0f

#define HSX_CH_SOIL_MOISTURE "soil_moisture"
#define HSX_UNIT_SOIL_MOISTURE "raw"
#define HSX_MIN_SOIL_MOISTURE 0.0f
#define HSX_MAX_SOIL_MOISTURE 4095.0f
