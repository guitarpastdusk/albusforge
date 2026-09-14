#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#define OBS_INTERVAL_US INT64_C(900000000)
#define OBS_MAX_AGE_S INT64_C(604800)
#define OBS_MAX_BYTES (1024U * 1024U)
#define OBS_SPOOL_BYTES (64U * 1024U * 1024U)
#define OBS_SPOOL_COUNT 672U
/* Deadline is monotonic, never advanced by request latency or a wall-clock
 * step. */
int64_t obs_next_deadline(int64_t previous, int64_t now);
unsigned obs_retry_seconds(unsigned failures, unsigned random,
                           unsigned retry_after);
bool obs_uuid_valid(const char *s);
bool obs_digest_valid(const char *s);
/* Reject a terminal response without discarding unacknowledged content. */
typedef enum {
  OBS_RETRY,
  OBS_ACK,
  OBS_DROP_EXPIRED,
  OBS_QUARANTINE,
  OBS_PAUSE
} obs_action;
obs_action obs_response_action(int status, bool exact_ack);
