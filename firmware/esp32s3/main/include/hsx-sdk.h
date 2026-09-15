#pragma once
#ifdef __cplusplus
extern "C" {
#endif
/** Runtime owns credentials, clock, sensor, sequence durability and HTTPS. */
void hsx_run(unsigned interval_s);
#ifdef __cplusplus
}
#endif
