#pragma once
#include <stdbool.h>
/* One card-wide marker owns both bounded directories. Credential rotation and
 * firmware rebuilds do not change this identity. No bearer enters the marker. */
typedef struct {
  const char *device_id;
  const char *observation_url;
  const char *capability_id;
  const char *payload_schema;
  const char *profile_id;
  unsigned profile_version;
} obs_owner_identity;
typedef enum {
  OBS_OWNER_OK,
  OBS_OWNER_UNBOUND,
  OBS_OWNER_MISMATCH,
  OBS_OWNER_CORRUPT,
  OBS_OWNER_IO
} obs_owner_status;
#define OBS_OWNER_MARKER "albus-observation-owner"
#define OBS_OWNER_SPOOL "albus-observations"
#define OBS_OWNER_QUARANTINE "albus-quarantine"
/* Initialize only before tasks start, on an empty/unclaimed spool+quarantine.
 * With initialize=false this is strictly read-only, including missing markers.
 * On every error preserve all existing files; never repair or overwrite. */
obs_owner_status obs_owner_check(const char *root,
                                 const obs_owner_identity *identity,
                                 bool initialize);
/* Exclusive ephemeral write probe, only after read-only ownership validation.
 * An existing .write-check is preserved and fails the probe. */
bool obs_owner_write_probe(const char *root, const obs_owner_identity *identity);
const char *obs_owner_reason(obs_owner_status status);
