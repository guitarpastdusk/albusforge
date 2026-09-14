# Observation maintenance

This bounded Cloud Run job reconciles interrupted image uploads and removes
retained media using the restricted runtime database role. It needs no DDL or
schema-owner credentials. Run migrations before scheduling it.

Stale reservations receive a fresh lease before object inspection outside SQL.
Finalization rechecks the original reservation credential, current capability,
lease, retention and UTC-day quota, then commits receipt time, usage and presence
atomically. Rotated, revoked, legacy unbound or invalid reservations become
permanent tombstones. Missing objects become retryable failed receipts, releasing quota while preserving
identity for a device retry until the
seven-day capture-age boundary. Recorded maintenance times prevent recurring
failures or full quotas from monopolizing bounded batches.

Expiry deletes image metadata and queues durable deletion intents through the
database trigger. Intents survive tenant/device deletion and fence new uploads.
The worker refuses to delete referenced media and conditions deletes on the
specific generation. Cleanup waits at least 120 seconds, longer than upload and
storage deadlines. A persisted paginated scan finds late writes after deletion;
only canonical `tenant/<uuid>/device/<uuid>/<uuid>.jpg` keys are eligible. Invalid
provider cursors reset for the next sweep.

A session advisory lock excludes overlapping sweepers. HTTP ingestion continues
using device/receipt locks; no SQL transaction spans storage I/O. Each phase
handles at most the configured limit. The job aborts after 240 seconds and leaves
failed work durable for retry. Logs contain aggregate counts, never credentials
or object keys.

| Environment | Default |
| --- | --- |
| `OBSERVATION_BUCKET` | Required private bucket |
| `OBSERVATION_MAINTENANCE_LIMIT` | 100 per phase, maximum 1000 |
| `OBSERVATION_ORPHAN_GRACE_S` | 120, minimum 120 |
| `OBSERVATION_MAX_DAILY_COUNT` | 1200; must match Cloudlink, maximum 10000 |
| `OBSERVATION_MAX_DAILY_BYTES` | 134217728; must match Cloudlink, maximum 1073741824 |
| `DB_*` | Standard restricted runtime database credentials |

Cloud Run requires database TLS. IAM needs bucket object read/list/delete. The
hourly schedule begins paused; enabling it requires reviewed bucket, IAM,
migration and deployment readiness gates.

Tests use real PostgreSQL with a restricted role and an immutable fake store.
They cover duplicate accounting, lease races, credential rotation/revocation,
quota rollover, expiry, late writes, overlapping jobs, pagination and deletion
fences. These establish neither live-cloud nor physical-board acceptance.
