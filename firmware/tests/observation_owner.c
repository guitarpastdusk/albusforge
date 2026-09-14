#include "observation-owner.h"
#include <assert.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
static bool fail_sync, short_write;
int obs_owner_test_sync(int fd) {
  if (fail_sync) { errno = EIO; return -1; }
  return fsync(fd);
}
size_t obs_owner_test_write(const void *bytes, size_t size, size_t count, FILE *file) {
  return fwrite(bytes, size, short_write ? 3 : count, file);
}
static void write_file(const char *name, const void *bytes, size_t length) {
  FILE *file = fopen(name, "wb"); assert(file);
  assert(fwrite(bytes, 1, length, file) == length); assert(!fclose(file));
}
static void read_file(const char *name, unsigned char *bytes, size_t length) {
  FILE *file = fopen(name, "rb"); assert(file);
  assert(fread(bytes, 1, length, file) == length); assert(fgetc(file) == EOF);
  assert(!fclose(file));
}
int main(void) {
  char root[] = "/tmp/albus-owner-XXXXXX"; assert(mkdtemp(root));
  char marker[256], spool[256], quarantine[256], legacy[512];
  snprintf(marker, sizeof marker, "%s/%s", root, OBS_OWNER_MARKER);
  snprintf(spool, sizeof spool, "%s/%s", root, OBS_OWNER_SPOOL);
  snprintf(quarantine, sizeof quarantine, "%s/%s", root, OBS_OWNER_QUARANTINE);
  obs_owner_identity owner = {
      .device_id = "12345678-1234-4234-8234-123456789abc",
      .observation_url = "https://staging.albusforge.ai/ingest/v2/devices/12345678-1234-4234-8234-123456789abc/observations",
      .capability_id = "camera", .payload_schema = "jpeg.v1",
      .profile_id = "freenove-esp32s3-n16r8-gc0308-usb-v1", .profile_version = 1};
  assert(obs_owner_check(root, &owner, false) == OBS_OWNER_UNBOUND);
  assert(!obs_owner_write_probe(root, &owner));
  assert(access(marker, F_OK) != 0);
  assert(obs_owner_check(root, &owner, true) == OBS_OWNER_OK);
  assert(mkdir(spool, 0700) == 0); assert(mkdir(quarantine, 0700) == 0);
  assert(obs_owner_write_probe(root, &owner));
  unsigned char original[768], after[768]; read_file(marker, original, sizeof original);
  /* The caller may rotate a bearer or rebuild firmware without changing any
   * ownership inputs. Neither token nor build identity exists in this API. */
  assert(obs_owner_check(root, &owner, true) == OBS_OWNER_OK);
  assert(obs_owner_check(root, &owner, false) == OBS_OWNER_OK);
  read_file(marker, after, sizeof after); assert(!memcmp(original, after, sizeof original));
  obs_owner_identity changed = owner;
  changed.device_id = "aaaaaaaa-1234-4234-8234-123456789abc";
  assert(obs_owner_check(root, &changed, true) == OBS_OWNER_MISMATCH);
  changed = owner; changed.observation_url = "https://albusforge.ai/ingest/v2/devices/12345678-1234-4234-8234-123456789abc/observations";
  assert(obs_owner_check(root, &changed, false) == OBS_OWNER_MISMATCH);
  changed = owner; changed.capability_id = "camera.other";
  assert(obs_owner_check(root, &changed, false) == OBS_OWNER_MISMATCH);
  changed = owner; changed.payload_schema = "jpeg.v2";
  assert(obs_owner_check(root, &changed, false) == OBS_OWNER_MISMATCH);
  changed = owner; changed.profile_id = "different-camera";
  assert(obs_owner_check(root, &changed, false) == OBS_OWNER_MISMATCH);
  changed = owner; changed.profile_version = 2;
  assert(obs_owner_check(root, &changed, false) == OBS_OWNER_MISMATCH);
  read_file(marker, after, sizeof after); assert(!memcmp(original, after, sizeof original));
  /* A known owner's data does not make a foreign/corrupt marker acceptable. */
  snprintf(legacy, sizeof legacy, "%s/.write-check", spool);
  write_file(legacy, "preserve", 8);
  assert(!obs_owner_write_probe(root, &owner));
  assert(!obs_owner_write_probe(root, &changed));
  assert(obs_owner_check(root, &owner, false) == OBS_OWNER_OK);
  assert(obs_owner_check(root, &changed, true) == OBS_OWNER_MISMATCH);
  unsigned char saved[8]; read_file(legacy, saved, sizeof saved); assert(!memcmp(saved, "preserve", 8));
  after[100] ^= 1; write_file(marker, after, sizeof after);
  assert(obs_owner_check(root, &owner, true) == OBS_OWNER_CORRUPT);
  read_file(legacy, saved, sizeof saved); assert(!memcmp(saved, "preserve", 8));
  /* Every truncated publication, including a zero-length file after a power
   * cut, remains rejected without repairs or deletion. */
  for (size_t length = 0; length < sizeof original; length++) {
    write_file(marker, original, length);
    assert(obs_owner_check(root, &owner, true) == OBS_OWNER_CORRUPT);
    struct stat info; assert(!stat(marker, &info)); assert(info.st_size == (off_t)length);
  }
  assert(!unlink(marker));
  assert(obs_owner_check(root, &owner, true) == OBS_OWNER_UNBOUND);
  assert(access(marker, F_OK) != 0); read_file(legacy, saved, sizeof saved);
  assert(!unlink(legacy));
  snprintf(legacy, sizeof legacy, "%s/unknown-legacy-frame", quarantine);
  write_file(legacy, "preserve", 8);
  assert(obs_owner_check(root, &owner, true) == OBS_OWNER_UNBOUND);
  assert(access(marker, F_OK) != 0); read_file(legacy, saved, sizeof saved);
  assert(!unlink(legacy));
  /* Deterministic real-file short writes and fsync failures cannot mark a card
   * ready. Incomplete files survive and block the next initialization. */
  short_write = true;
  assert(obs_owner_check(root, &owner, true) == OBS_OWNER_IO);
  short_write = false;
  assert(obs_owner_check(root, &owner, true) == OBS_OWNER_CORRUPT);
  assert(!unlink(marker));
  fail_sync = true;
  assert(obs_owner_check(root, &owner, true) == OBS_OWNER_IO);
  fail_sync = false;
  write_file(marker, "", 0); /* Simulated power loss before failed flush persisted. */
  assert(obs_owner_check(root, &owner, true) == OBS_OWNER_CORRUPT);
  assert(!unlink(marker));
  assert(obs_owner_check(root, &owner, true) == OBS_OWNER_OK);
  assert(!unlink(marker)); assert(!rmdir(spool)); assert(!rmdir(quarantine)); assert(!rmdir(root));
  puts("card ownership, identity rotation, legacy preservation and power-loss tests passed");
  return 0;
}
