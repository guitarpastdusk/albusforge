#include "observation-spool.h"
#include <dirent.h>
#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#define HEADER_SIZE 160
static unsigned crc32(const unsigned char *bytes, size_t length) {
  unsigned crc = 0xffffffffU;
  for (size_t i = 0; i < length; i++) {
    crc ^= bytes[i];
    for (unsigned bit = 0; bit < 8; bit++)
      crc = (crc >> 1) ^ (0xedb88320U & -(crc & 1U));
  }
  return ~crc;
}
static bool path(char *out, size_t size, const char *dir, const char *id,
                 const char *suffix) {
  return obs_uuid_valid(id) &&
         snprintf(out, size, "%s/%s%s", dir, id, suffix) > 0 &&
         strlen(dir) + strlen(id) + strlen(suffix) + 2 < size;
}
static bool header(FILE *file, obs_record *record) {
  char raw[HEADER_SIZE + 1] = {0};
  unsigned long long captured = 0, bytes = 0;
  if (fread(raw, 1, HEADER_SIZE, file) != HEADER_SIZE)
    return false;
  char expected[9];
  snprintf(expected, sizeof expected, "%08x", crc32((unsigned char *)raw, 151));
  if (memcmp(expected, raw + 151, 9))
    return false;
  if (sscanf(raw, "HSXOBS1 %36s %64s %llu %llu", record->id, record->sha256,
             &captured, &bytes) != 4)
    return false;
  if (!obs_uuid_valid(record->id) || !obs_digest_valid(record->sha256) ||
      captured < 1700000000 || captured > 253402300799ULL || !bytes ||
      bytes > OBS_MAX_BYTES)
    return false;
  record->captured_at = (int64_t)captured;
  record->bytes = (size_t)bytes;
  if (fseek(file, 0, SEEK_END) ||
      ftell(file) != (long)(HEADER_SIZE + record->bytes) ||
      fseek(file, HEADER_SIZE, SEEK_SET))
    return false;
  return true;
}
bool obs_spool_put(const char *dir, const obs_record *record,
                   const unsigned char *bytes) {
  char temp[256], final[256], raw[HEADER_SIZE] = {0};
  if (!obs_digest_valid(record->sha256) || !record->bytes ||
      record->bytes > OBS_MAX_BYTES || record->captured_at < 1700000000 ||
      !path(temp, sizeof temp, dir, record->id, ".part") ||
      !path(final, sizeof final, dir, record->id, ".obs"))
    return false;
  struct stat existing;
  if (stat(final, &existing) == 0)
    return false;
  int n =
      snprintf(raw, sizeof raw, "HSXOBS1 %s %s %" PRId64 " %zu\n", record->id,
               record->sha256, record->captured_at, record->bytes);
  if (n < 0 || n >= 151)
    return false;
  snprintf(raw + 151, 9, "%08x", crc32((unsigned char *)raw, 151));
  FILE *file = fopen(temp, "wb");
  if (!file)
    return false;
  bool ok = fwrite(raw, 1, HEADER_SIZE, file) == HEADER_SIZE &&
            fwrite(bytes, 1, record->bytes, file) == record->bytes &&
            fflush(file) == 0 && fsync(fileno(file)) == 0;
  if (fclose(file))
    ok = false;
  if (ok && rename(temp, final) == 0)
    return true;
  unlink(temp);
  return false;
}
bool obs_spool_read(const char *dir, const char *id, obs_record *record,
                    unsigned char **bytes) {
  char name[256];
  *bytes = NULL;
  if (!path(name, sizeof name, dir, id, ".obs"))
    return false;
  FILE *file = fopen(name, "rb");
  if (!file)
    return false;
  bool ok = header(file, record) && !strcmp(record->id, id);
  if (ok) {
    *bytes = malloc(record->bytes);
    ok = *bytes && fread(*bytes, 1, record->bytes, file) == record->bytes;
  }
  fclose(file);
  if (!ok) {
    free(*bytes);
    *bytes = NULL;
  }
  return ok;
}
bool obs_spool_remove(const char *dir, const char *id) {
  char name[256];
  return path(name, sizeof name, dir, id, ".obs") &&
         (unlink(name) == 0 || errno == ENOENT);
}
static bool scan_limits(const char *dir, int64_t now, const char *claimed,
                        size_t reserve_bytes, size_t max_count,
                        size_t max_bytes, obs_record *oldest,
                        obs_spool_stats *stats) {
  *stats = (obs_spool_stats){0};
  *oldest = (obs_record){0};
  if (reserve_bytes > OBS_MAX_BYTES)
    return false;
  /* Bounded rescans avoid allocating a directory-sized index on the MCU. */
  for (;;) {
    DIR *directory = opendir(dir);
    if (!directory)
      return false;
    struct dirent *entry;
    obs_record candidate = {0};
    size_t count = 0, total = 0;
    while ((entry = readdir(directory))) {
      size_t len = strlen(entry->d_name);
      if (len != 40 && len != 41)
        continue;
      char id[37];
      memcpy(id, entry->d_name, 36);
      id[36] = 0;
      if (!obs_uuid_valid(id))
        continue;
      char name[256];
      if (!path(name, sizeof name, dir, id, entry->d_name + 36)) {
        closedir(directory);
        return false;
      }
      if (!strcmp(entry->d_name + 36, ".part")) {
        if (unlink(name) != 0) {
          closedir(directory);
          return false;
        }
        stats->corrupt++;
        continue;
      }
      if (strcmp(entry->d_name + 36, ".obs"))
        continue;
      FILE *file = fopen(name, "rb");
      obs_record r = {0};
      bool valid = file && header(file, &r) && !strcmp(r.id, id);
      if (file)
        fclose(file);
      if (!valid) {
        if (unlink(name)) {
          closedir(directory);
          return false;
        }
        stats->corrupt++;
        continue;
      }
      bool owned = claimed && !strcmp(claimed, id);
      if (!owned && r.captured_at < now - OBS_MAX_AGE_S) {
        if (unlink(name)) {
          closedir(directory);
          return false;
        }
        stats->dropped++;
        continue;
      }
      count++;
      total += r.bytes + HEADER_SIZE;
      if (!owned &&
          (!candidate.id[0] || r.captured_at < candidate.captured_at ||
           (r.captured_at == candidate.captured_at &&
            strcmp(r.id, candidate.id) < 0)))
        candidate = r;
    }
    closedir(directory);
    if (count + (reserve_bytes ? 1 : 0) <= max_count &&
        total + reserve_bytes + (reserve_bytes ? HEADER_SIZE : 0) <=
            max_bytes) {
      *oldest = candidate;
      stats->count = count;
      stats->bytes = total;
      return true;
    }
    if (!candidate.id[0] || !obs_spool_remove(dir, candidate.id))
      return false;
    stats->dropped++;
  }
}

bool obs_spool_scan(const char *dir, int64_t now, const char *claimed,
                    size_t reserve_bytes, obs_record *oldest,
                    obs_spool_stats *stats) {
  return scan_limits(dir, now, claimed, reserve_bytes, OBS_SPOOL_COUNT,
                     OBS_SPOOL_BYTES, oldest, stats);
}
bool obs_spool_quarantine(const char *dir, const char *quarantine,
                          const obs_record *record, int64_t now,
                          obs_spool_stats *stats) {
  obs_record oldest;
  char source[256], target[256];
  if (!path(source, sizeof source, dir, record->id, ".obs") ||
      !path(target, sizeof target, quarantine, record->id, ".obs"))
    return false;
  if (!scan_limits(quarantine, now, NULL, record->bytes, 32, 8U * 1024U * 1024U,
                   &oldest, stats))
    return false;
  struct stat exists;
  if (stat(target, &exists) == 0)
    return false;
  if (rename(source, target))
    return false;
  stats->count++;
  stats->bytes += record->bytes + HEADER_SIZE;
  return true;
}

bool obs_quarantine_scan(const char *dir, int64_t now, obs_spool_stats *stats) {
  obs_record oldest;
  return scan_limits(dir, now, NULL, 0, 32, 8U * 1024U * 1024U, &oldest, stats);
}
