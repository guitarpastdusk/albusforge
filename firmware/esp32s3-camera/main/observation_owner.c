#include "observation-owner.h"
#include "observation-policy.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#define OWNER_SIZE 768
#define CRC_OFFSET (OWNER_SIZE - 9)
#ifdef OBS_OWNER_TESTING
extern int obs_owner_test_sync(int fd);
extern size_t obs_owner_test_write(const void *bytes, size_t size, size_t count, FILE *file);
#define owner_sync obs_owner_test_sync
#define owner_write obs_owner_test_write
#else
#define owner_sync fsync
#define owner_write fwrite
#endif
static unsigned crc32(const unsigned char *bytes, size_t length) {
  unsigned crc = 0xffffffffU;
  for (size_t i = 0; i < length; i++) {
    crc ^= bytes[i];
    for (unsigned bit = 0; bit < 8; bit++)
      crc = (crc >> 1) ^ (0xedb88320U & -(crc & 1U));
  }
  return ~crc;
}
static bool field_valid(const char *value, size_t maximum) {
  if (!value || !*value || strlen(value) > maximum)
    return false;
  for (const unsigned char *c = (const unsigned char *)value; *c; c++)
    if (*c <= 32 || *c >= 127)
      return false;
  return true;
}
static bool expected_marker(const obs_owner_identity *owner,
                            unsigned char bytes[OWNER_SIZE]) {
  if (!owner || !owner->device_id || !obs_uuid_valid(owner->device_id) ||
      !field_valid(owner->observation_url, 256) ||
      strncmp(owner->observation_url, "https://", 8) ||
      !field_valid(owner->capability_id, 64) ||
      !field_valid(owner->payload_schema, 32) ||
      !field_valid(owner->profile_id, 120) || !owner->profile_version)
    return false;
  memset(bytes, 0, OWNER_SIZE);
  int length = snprintf((char *)bytes, CRC_OFFSET,
                        "HSXOWNER1\n%s\n%s\n%s\n%s\n%s\n%u\n",
                        owner->device_id, owner->observation_url,
                        owner->capability_id, owner->payload_schema,
                        owner->profile_id, owner->profile_version);
  if (length < 0 || length >= CRC_OFFSET)
    return false;
  snprintf((char *)bytes + CRC_OFFSET, 9, "%08x", crc32(bytes, CRC_OFFSET));
  return true;
}
static bool path(char *out, size_t size, const char *root, const char *name) {
  int length = snprintf(out, size, "%s/%s", root, name);
  return length > 0 && (size_t)length < size;
}
/* Unknown files, directories and old .part/.write-check entries all count as
 * legacy data. Never call the destructive record scanner while unbound. */
static obs_owner_status empty(const char *root, const char *name) {
  char full[512];
  if (!path(full, sizeof full, root, name))
    return OBS_OWNER_IO;
  DIR *directory = opendir(full);
  if (!directory)
    return errno == ENOENT ? OBS_OWNER_OK : OBS_OWNER_IO;
  struct dirent *entry;
  obs_owner_status result = OBS_OWNER_OK;
  errno = 0;
  while ((entry = readdir(directory))) {
    if (strcmp(entry->d_name, ".") && strcmp(entry->d_name, "..")) {
      result = OBS_OWNER_UNBOUND;
      break;
    }
  }
  if (!entry && errno)
    result = OBS_OWNER_IO;
  if (closedir(directory))
    result = OBS_OWNER_IO;
  return result;
}
obs_owner_status obs_owner_check(const char *root,
                                 const obs_owner_identity *identity,
                                 bool initialize) {
  unsigned char expected[OWNER_SIZE], actual[OWNER_SIZE];
  char marker[512];
  if (!root || !expected_marker(identity, expected) ||
      !path(marker, sizeof marker, root, OBS_OWNER_MARKER))
    return OBS_OWNER_IO;
  int flags = O_RDONLY;
#ifdef O_NOFOLLOW
  flags |= O_NOFOLLOW;
#endif
  int fd = open(marker, flags);
  if (fd >= 0) {
    struct stat info;
    if (fstat(fd, &info) || !S_ISREG(info.st_mode) ||
        info.st_size != OWNER_SIZE) {
      close(fd);
      return OBS_OWNER_CORRUPT;
    }
    FILE *file = fdopen(fd, "rb");
    if (!file) {
      close(fd);
      return OBS_OWNER_IO;
    }
    bool ok = fread(actual, 1, OWNER_SIZE, file) == OWNER_SIZE &&
              fgetc(file) == EOF && !ferror(file);
    if (fclose(file))
      ok = false;
    if (!ok)
      return OBS_OWNER_IO;
    char crc[9];
    snprintf(crc, sizeof crc, "%08x", crc32(actual, CRC_OFFSET));
    if (memcmp(actual, "HSXOWNER1\n", 10) ||
        memcmp(actual + CRC_OFFSET, crc, 9))
      return OBS_OWNER_CORRUPT;
    return memcmp(actual, expected, OWNER_SIZE) ? OBS_OWNER_MISMATCH
                                               : OBS_OWNER_OK;
  }
  if (errno != ENOENT)
    return OBS_OWNER_IO;
  if (!initialize)
    return OBS_OWNER_UNBOUND;
  obs_owner_status status = empty(root, OBS_OWNER_SPOOL);
  if (status == OBS_OWNER_OK)
    status = empty(root, OBS_OWNER_QUARANTINE);
  if (status != OBS_OWNER_OK)
    return status;
  flags = O_WRONLY | O_CREAT | O_EXCL;
#ifdef O_NOFOLLOW
  flags |= O_NOFOLLOW;
#endif
  fd = open(marker, flags, 0600);
  if (fd < 0)
    return OBS_OWNER_IO;
  FILE *file = fdopen(fd, "wb");
  if (!file) {
    close(fd);
    return OBS_OWNER_IO;
  }
  /* Direct exclusive publication deliberately leaves an incomplete marker on
   * failure: the next boot rejects it instead of silently claiming old data.
   * ESP-IDF FAT fsync maps to f_sync, including the file's directory entry and
   * disk CTRL_SYNC. POSIX directory fds are not supported on that VFS. */
  bool ok = owner_write(expected, 1, OWNER_SIZE, file) == OWNER_SIZE &&
            fflush(file) == 0 && owner_sync(fileno(file)) == 0;
  if (fclose(file))
    ok = false;
#ifndef ESP_PLATFORM
  if (ok) {
    int directory = open(root, O_RDONLY);
    if (directory < 0)
      ok = false;
    else {
      ok = owner_sync(directory) == 0;
      if (close(directory))
        ok = false;
    }
  }
#endif
  if (!ok)
    return OBS_OWNER_IO;
  return obs_owner_check(root, identity, false);
}
bool obs_owner_write_probe(const char *root, const obs_owner_identity *identity) {
  if (obs_owner_check(root, identity, false) != OBS_OWNER_OK)
    return false;
  char probe[512];
  if (!path(probe, sizeof probe, root, OBS_OWNER_SPOOL "/.write-check"))
    return false;
  int fd = open(probe, O_WRONLY | O_CREAT | O_EXCL, 0600);
  if (fd < 0)
    return false;
  FILE *file = fdopen(fd, "wb");
  if (!file) {
    close(fd);
    return false;
  }
  bool ok = fwrite("1", 1, 1, file) == 1 && fflush(file) == 0 &&
            owner_sync(fileno(file)) == 0;
  if (fclose(file))
    ok = false;
  /* Remove only the file this call exclusively created. Existing probe files
   * never reach this branch, including leftovers from an interrupted boot. */
  if (unlink(probe))
    ok = false;
  return ok;
}
const char *obs_owner_reason(obs_owner_status status) {
  switch (status) {
  case OBS_OWNER_OK:
    return "none";
  case OBS_OWNER_UNBOUND:
    return "spool_owner_unbound";
  case OBS_OWNER_MISMATCH:
    return "spool_owner_mismatch";
  case OBS_OWNER_CORRUPT:
    return "spool_owner_corrupt";
  default:
    return "spool_owner_io";
  }
}
