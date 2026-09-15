#pragma once
#include "observation-policy.h"
/* One fsync'd record contains immutable metadata and JPEG. Rename publishes it.
 * Caller serializes all operations; claimed ID must be excluded from eviction.
 */
typedef struct {
  char id[37];
  char sha256[65];
  int64_t captured_at;
  size_t bytes;
} obs_record;
typedef struct {
  size_t count, bytes;
  unsigned dropped, corrupt;
} obs_spool_stats;
bool obs_spool_put(const char *dir, const obs_record *record,
                   const unsigned char *bytes);
bool obs_spool_read(const char *dir, const char *id, obs_record *record,
                    unsigned char **bytes);
bool obs_spool_remove(const char *dir, const char *id);
bool obs_spool_scan(const char *dir, int64_t now, const char *claimed,
                    size_t reserve_bytes, obs_record *oldest,
                    obs_spool_stats *stats);

bool obs_spool_quarantine(const char *dir, const char *quarantine,
                          const obs_record *record, int64_t now,
                          obs_spool_stats *stats);

bool obs_quarantine_scan(const char *dir, int64_t now, obs_spool_stats *stats);
