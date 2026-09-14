# Native camera physical acceptance and private evidence

Status: procedure and recorder implemented; physical results are **not yet
established**. This document does not authorize a flash or claim deployed cloud
infrastructure. Use it after the exact native artifact, private device fixture,
current full-flash backup, and staging receiver are ready for the hardware run.
The [native candidate runbook](../firmware/esp32s3-camera/README.md) describes its
partition layout and setup hotspot. Keep physical acceptance distinct from mock
posting and successful compilation.

## Record a normal 24-hour run

Use a dedicated staging device/camera capability so mock observations from other
tests cannot inflate its counts. Check that local preview is recognizable and
that `/health` reports a synchronized clock, writable SD, and successful upload.
Note the artifact manifest digest, device ID, capability, UTC start time and
fresh backup digest in a private operator record. Do not put device tokens,
Wi-Fi credentials, USB setup passwords, photographs or full flash dumps in a PR.

From the repository root, start the recorder with the board's explicit LAN IP:

```sh
python3 firmware/tools/record_camera_evidence.py \
  --origin http://192.168.1.241 \
  --output /private/tmp/plant-camera-24h-evidence \
  --hours 24 --interval 30
```

Use a new output directory each time. The address above is an example from
bring-up; verify the current board address. The recorder accepts only explicit
loopback/RFC1918 HTTP addresses, refuses redirects and environment proxies, and
never sends a cloud token. Every 30 seconds it reads `/health` and `/snapshot`.
Run it as a standalone macOS/Linux process; each request has a ten-second total
deadline, including slow HTTP headers, and a response size limit.
It saves only whitelisted health fields, JPEG byte lengths and SHA256 values.
It never saves the JPEG payload. Files are mode 0600 in a new mode-0700 directory
outside the repository:

- `run.json`: address, requested duration/poll interval, start time and recorder
  source digest.
- `observations.jsonl`: actual observation timing, sanitized health and snapshot
  metadata, or a bounded failure label.
- `summary.json`: elapsed time, observed capture intervals, queue changes, losses,
  and the limits of the evidence. It is refreshed during the run.

Ctrl-C writes a partial summary. Short runs remain marked as insufficient for
24-hour evidence. A `local_capture_cadence_matches_15_minutes` result requires
at least 86,400 seconds of actual monotonic elapsed time, at least 96 observed
capture timestamps strictly after startup (preexisting captures are excluded),
observed intervals within 900±5 seconds, successful health polling within 65
seconds of both window edges and throughout the run, and no observed loss-counter
or capture/upload timestamp reset. The raw
intervals and gaps remain available for review. A clock step, missed observation,
or reboot can prevent that conclusion; investigate rather than silently widening
the tolerance.

The recorder's local snapshots are separate preview captures. Their hashes
cannot be equated to scheduled upload hashes. Local health polling also misses
some 10-second catch-up uploads. Therefore it always leaves cloud receipt
verification and physical acceptance unresolved. Independently audit the
staging receiver for the dedicated device/capability and exact UTC window:
96 distinct accepted observation IDs, plausible capture intervals, one stored
image per accepted ID, matching media digests/metadata, and single-count usage
accounting despite retries. Confirm the tenant-authorized latest/history view
returns those images. Record cloud results privately and publish only a redacted
pass/fail summary with artifact identity.

## Separate fault-recovery windows

Run fault tests separately from the uninterrupted 24-hour cadence window. Back up
any existing card contents before power-cut tests; FAT/controller behavior must
be measured on the physical card. The runtime uses its two spool folders and
root ownership marker, and never formats the card. Preserve all three together.

1. **45-minute cloud outage with LAN intact.** Start a separate two-hour recorder
   run. Block this board's upstream Internet access while preserving LAN access;
   do not interrupt other household devices. Keep the board powered and clock
   synchronized before the outage. Over 45 minutes, expect approximately three
   new queued captures, depending on the starting phase. Local preview should
   continue; capture timestamps should continue on the 900-second schedule.
   Restore this board's upstream access. Observe the queue drain, successful
   upload timestamps advance, and no increases in drop/corruption counters.
   Audit cloud receipt IDs and usage to prove every queued frame was stored once.
   A falling queue count alone does not prove delivery.

2. **Full Wi-Fi loss and setup fallback.** In a separate window, disconnect only
   this board from its network. After 60 seconds, verify `Plant-A Setup` appears
   with a new password on physical USB serial. Open the literal AP address and
   check local preview. Correct Wi-Fi through the board portal; verify the hotspot
   closes after station connection and retained observations drain. Preserve the
   private Wi-Fi NVS value across a normal reset without re-entering credentials.

3. **Reset with queued observations.** With cloud access blocked and at least one
   pending frame, note the queue and UTC window. Reset the board. It must wait for
   fresh clock synchronization, recover its existing spool records, and retain
   their observation identity. Restore cloud access and audit deduplication.
   The first post-boot capture has a new jittered schedule; this is intentionally
   a separate test from uninterrupted 900-second cadence.

4. **Power cut around write/ack boundaries.** With a backed-up test card, repeat
   controlled cuts during record publication and during an upload/ack window.
   After restart, incomplete/corrupt records must be removed and counted; complete
   records must remain retryable. There must be no false successful-delivery claim,
   reused UUID with different bytes, or duplicate accounting. This physical test
   supplies evidence that portable filesystem tests cannot establish.

5. **Missing and unavailable card.** Power off before removing the card, then boot
   without it. Scheduled cloud capture must remain paused, `/health` must report
   storage unavailable, and preview/setup must work. Power off, restore the card,
   and restart; verify mount/recovery and upload behavior. An SD write failure
   requires restart with working storage in this candidate; automatic remount is
   not claimed.

6. **Authentication rejection versus bad frame.** Use the dedicated staging
   fixture to revoke its device credential and verify 401/403 pauses cloud upload
   while pending records remain. Obtain a reviewed fresh configuration before
   reinstalling. Existing mock receiver tests cover 400/409/413/415/422 quarantine,
   matching acknowledgments, expiration, limits and corruption. Do not manufacture
   a physical result from those host tests. Physical quarantine evidence, if
   required for release, must use a controlled staging rejection and verify the
   32-record/8-MiB bounds and loss counters.

Native profile approval requires reviewed physical results, a successful receiver
and tenant-read audit, the uninterrupted cadence evidence, and explicit disposition
of every failed or untested case. An elapsed timer, a visible picture, or a green
compiler job alone is insufficient.

### Reprovisioning and card ownership

Use a private, backed-up test card for this separate acceptance window. Queue a
synthetic/test capture for the original staging identity, then reboot with a
rotated token for the same device, endpoint and camera profile: ownership should
remain valid and the stable queued observation ID should upload once. A firmware
rebuild with the same identity must also preserve ownership.

Reprovision to a different device UUID or observation origin while preserving the
card. Confirm `storage_ready=false` and `spool_owner_mismatch`, no queued upload
or record cleanup, and working local preview/setup. Restore the original
configuration to recover its queue. Test a copied legacy card without a marker,
a truncated marker and a failed marker flush: these must preserve existing files
and remain blocked rather than infer a new owner. Host tests simulate all marker
truncation lengths and injected short-write/fsync failures; physical FAT and card
controller behavior still needs this separate evidence. Never remove or rewrite
ownership metadata to adopt private photographs into another device identity.
