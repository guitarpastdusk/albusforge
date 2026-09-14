#include "observation-policy.h"
#include <string.h>
int64_t obs_next_deadline(int64_t previous, int64_t now) {
  if (previous > now)
    return previous;
  return previous + ((now - previous) / OBS_INTERVAL_US + 1) * OBS_INTERVAL_US;
}
unsigned obs_retry_seconds(unsigned failures, unsigned random,
                           unsigned retry_after) {
  unsigned exponent = failures > 6 ? 6 : failures;
  unsigned delay = (10U << exponent) + (random % 11U);
  if (delay > 900)
    delay = 900;
  if (retry_after > delay)
    delay = retry_after > 3600 ? 3600 : retry_after;
  return delay;
}
bool obs_uuid_valid(const char *s) {
  if (!s || strlen(s) != 36)
    return false;
  for (size_t i = 0; i < 36; i++) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (s[i] != '-')
        return false;
    } else if (!((s[i] >= '0' && s[i] <= '9') || (s[i] >= 'a' && s[i] <= 'f')))
      return false;
  }
  return s[14] == '4' &&
         (s[19] == '8' || s[19] == '9' || s[19] == 'a' || s[19] == 'b');
}
bool obs_digest_valid(const char *s) {
  if (!s || strlen(s) != 64)
    return false;
  for (size_t i = 0; i < 64; i++)
    if (!((s[i] >= '0' && s[i] <= '9') || (s[i] >= 'a' && s[i] <= 'f')))
      return false;
  return true;
}
obs_action obs_response_action(int status, bool exact_ack) {
  if ((status == 200 || status == 201) && exact_ack)
    return OBS_ACK;
  if (status == 410)
    return OBS_DROP_EXPIRED;
  if (status == 401 || status == 403)
    return OBS_PAUSE;
  if (status == 400 || status == 409 || status == 413 || status == 415 ||
      status == 422)
    return OBS_QUARANTINE;
  return OBS_RETRY;
}
