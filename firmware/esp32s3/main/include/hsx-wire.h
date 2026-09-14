#pragma once
#include <stddef.h>
#include <stdint.h>
int hsx_encode_packet(char *output, size_t capacity, const char *device, uint64_t sequence, int64_t timestamp, float lux, uint64_t uptime);
