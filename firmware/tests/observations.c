#include "observation-spool.h"
#include "setup-form.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
int main(void) {
  assert(setup_host_allowed("192.168.4.1"));
  assert(setup_host_allowed("192.168.4.1:80"));
  assert(!setup_host_allowed("attacker.example"));
  assert(!setup_host_allowed("192.168.4.1.attacker.example"));
  assert(setup_origin_allowed(NULL));
  assert(setup_origin_allowed("http://192.168.4.1"));
  assert(!setup_origin_allowed("https://attacker.example"));
  assert(!setup_origin_allowed("null"));
  assert(!setup_origin_allowed(""));
  char ssid[33], password[64];
  assert(
      setup_form_parse("csrf=nonce&ssid=Plant+WiFi&password=private%26password",
                       "nonce", ssid, password));
  assert(!strcmp(ssid, "Plant WiFi") && !strcmp(password, "private&password"));
  assert(!setup_form_parse("csrf=wrong&ssid=Plant&password=password", "nonce",
                           ssid, password));
  assert(!setup_form_parse(
      "csrf=nonce&ssid=Plant&password=password&password=different", "nonce",
      ssid, password));
  assert(!setup_form_parse("csrf=nonce&ssid=%00hidden&password=password",
                           "nonce", ssid, password));
  assert(!setup_form_parse("csrf=nonce&ssid=%q0&password=password", "nonce",
                           ssid, password));
  assert(!setup_form_parse("csrf=nonce&ssid=Plant&password=short", "nonce",
                           ssid, password));
  assert(obs_response_action(409, false) == OBS_QUARANTINE);
  assert(obs_response_action(422, false) == OBS_QUARANTINE);
  assert(obs_next_deadline(0, 0) == OBS_INTERVAL_US);
  assert(obs_next_deadline(0, OBS_INTERVAL_US * 3 + 1) == OBS_INTERVAL_US * 4);
  assert(obs_next_deadline(100, 99) == 100);
  assert(obs_retry_seconds(0, 0, 0) >= 10);
  assert(obs_retry_seconds(100, 100, 100000) == 3600);
  assert(obs_response_action(201, true) == OBS_ACK);
  assert(obs_response_action(200, false) == OBS_RETRY);
  assert(obs_response_action(302, true) == OBS_RETRY);
  assert(obs_response_action(401, true) == OBS_PAUSE);
  assert(obs_response_action(410, false) == OBS_DROP_EXPIRED);
  assert(!obs_uuid_valid("../../bad"));
  assert(!obs_digest_valid("abcdef"));
  char directory[] = "/tmp/albus-spool-XXXXXX";
  assert(mkdtemp(directory));
  obs_record a = {.id = "12345678-1234-4234-8234-123456789abc",
                  .captured_at = 1789300000,
                  .bytes = 4};
  memset(a.sha256, 'a', 64);
  a.sha256[64] = 0;
  unsigned char image[] = {0xff, 0xd8, 0xff, 0xd9};
  assert(obs_spool_put(directory, &a, image));
  assert(!obs_spool_put(directory, &a, image));
  obs_record read;
  unsigned char *bytes;
  assert(obs_spool_read(directory, a.id, &read, &bytes));
  assert(!memcmp(bytes, image, 4));
  assert(!strcmp(read.id, a.id));
  free(bytes);
  obs_record oldest;
  obs_spool_stats stats;
  assert(obs_spool_scan(directory, a.captured_at, NULL, 0, &oldest, &stats));
  assert(stats.count == 1);
  assert(!strcmp(oldest.id, a.id));
  assert(obs_spool_scan(directory, a.captured_at, a.id, 0, &oldest, &stats));
  assert(!oldest.id[0]);
  assert(stats.count == 1);
  /* A partial write is never treated as a committed record after reboot. */
  char path[256];
  snprintf(path, sizeof path, "%s/22345678-1234-4234-8234-123456789abc.part",
           directory);
  FILE *file = fopen(path, "wb");
  assert(file);
  assert(fwrite("partial", 1, 7, file) == 7);
  fclose(file);
  assert(obs_spool_scan(directory, a.captured_at, NULL, 0, &oldest, &stats));
  assert(stats.corrupt == 1);
  assert(access(path, F_OK) != 0);
  /* Same-sized metadata corruption must fail CRC validation. */
  snprintf(path, sizeof path, "%s/%s.obs", directory, a.id);
  file = fopen(path, "r+b");
  assert(file);
  assert(fseek(file, 110, SEEK_SET) == 0);
  fputc('7', file);
  fclose(file);
  assert(!obs_spool_read(directory, a.id, &read, &bytes));
  assert(obs_spool_scan(directory, a.captured_at, NULL, 0, &oldest, &stats));
  assert(stats.corrupt == 1);
  assert(stats.count == 0);
  assert(obs_spool_put(directory, &a, image));
  assert(obs_spool_scan(directory, a.captured_at + OBS_MAX_AGE_S + 1, NULL, 0,
                        &oldest, &stats));
  assert(stats.dropped == 1);
  assert(stats.count == 0);
  /* Count limit evicts the oldest unsent item and never the active upload. */
  for (unsigned i = 0; i < OBS_SPOOL_COUNT; i++) {
    snprintf(a.id, sizeof a.id, "%08x-1234-4234-8234-123456789abc", i);
    a.captured_at = 1789300000 + i;
    assert(obs_spool_put(directory, &a, image));
  }
  assert(obs_spool_scan(directory, a.captured_at,
                        "00000000-1234-4234-8234-123456789abc", 4, &oldest,
                        &stats));
  assert(stats.count == OBS_SPOOL_COUNT - 1);
  assert(stats.dropped == 1);
  assert(!strcmp(oldest.id, "00000002-1234-4234-8234-123456789abc"));
  assert(obs_spool_scan(directory, a.captured_at + OBS_MAX_AGE_S + 1, NULL, 0,
                        &oldest, &stats));
  assert(stats.count == 0);
  /* Byte quota includes metadata and can bind before the frame-count limit. */
  unsigned char *large = calloc(1, OBS_MAX_BYTES);
  assert(large);
  a.bytes = OBS_MAX_BYTES;
  for (unsigned i = 0; i < 63; i++) {
    snprintf(a.id, sizeof a.id, "%08x-1234-4234-8234-123456789abc", i);
    a.captured_at = 1789300000 + i;
    assert(obs_spool_put(directory, &a, large));
  }
  free(large);
  assert(obs_spool_scan(directory, a.captured_at, NULL, OBS_MAX_BYTES, &oldest,
                        &stats));
  assert(stats.count == 62 && stats.dropped == 1);
  assert(stats.bytes + OBS_MAX_BYTES + 160 <= OBS_SPOOL_BYTES);
  assert(obs_spool_scan(directory, a.captured_at + OBS_MAX_AGE_S + 1, NULL, 0,
                        &oldest, &stats));
  assert(stats.count == 0);
  char quarantine[256];
  snprintf(quarantine, sizeof quarantine, "%s/quarantine", directory);
  assert(mkdir(quarantine, 0700) == 0);
  a.bytes = 4;
  unsigned quarantined_drops = 0;
  for (unsigned i = 0; i < 34; i++) {
    snprintf(a.id, sizeof a.id, "%08x-1234-4234-8234-123456789abc", i);
    a.captured_at = 1789300000 + i;
    assert(obs_spool_put(directory, &a, image));
    assert(
        obs_spool_quarantine(directory, quarantine, &a, a.captured_at, &stats));
    quarantined_drops += stats.dropped;
  }
  assert(stats.count == 32 && quarantined_drops == 2);
  assert(obs_quarantine_scan(quarantine, a.captured_at + OBS_MAX_AGE_S + 1,
                             &stats));
  assert(stats.count == 0);
  large = calloc(1, OBS_MAX_BYTES);
  assert(large);
  a.bytes = OBS_MAX_BYTES;
  for (unsigned i = 0; i < 8; i++) {
    snprintf(a.id, sizeof a.id, "%08x-1234-4234-8234-123456789abc", i);
    a.captured_at = 1789300000 + i;
    assert(obs_spool_put(directory, &a, large));
    assert(
        obs_spool_quarantine(directory, quarantine, &a, a.captured_at, &stats));
  }
  free(large);
  assert(stats.count == 7 && stats.bytes <= 8U * 1024U * 1024U &&
         stats.dropped == 1);
  assert(obs_quarantine_scan(quarantine, a.captured_at + OBS_MAX_AGE_S + 1,
                             &stats));
  assert(stats.count == 0);
  assert(rmdir(quarantine) == 0);
  assert(rmdir(directory) == 0);
  assert(!obs_spool_put(directory, &a, image));
  puts("observation scheduler/retry/spool tests passed");
  return 0;
}
