#pragma once
#include <stddef.h>
#include <stdint.h>
/** Wire v1 encoder. One packet may carry several numeric channels. */
#define HSX_MAX_READINGS 8
typedef struct {
  const char *channel; /* provisioned channel key, see hsx-channels.h */
  float value;
  float min; /* accepted channel range; outside it the packet is refused */
  float max;
  /* Nonzero marks a value a driver could not actually measure. Such a packet
   * always carries "synthetic:<channel>" in st.health so no consumer can read
   * a stubbed value as a real measurement. Never set it for real samples. */
  int synthetic;
} hsx_reading_t;
int hsx_encode_readings(char *output, size_t capacity, const char *device, uint64_t sequence, int64_t timestamp, const hsx_reading_t *readings, size_t count, uint64_t uptime);
/** Single-channel compatibility wrapper: HSX_CHANNEL, range 0..65535. */
int hsx_encode_packet(char *output, size_t capacity, const char *device, uint64_t sequence, int64_t timestamp, float lux, uint64_t uptime);
