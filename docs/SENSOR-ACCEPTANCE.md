# Deployed sensor acceptance

This is simulator acceptance, not physical-device evidence. Use a dedicated fixture in staging first; repeat the minimal smoke in production only after verified promotion. The local-only `provision` and `simulate` commands retain their original safeguards.

## Preparation and authority

The release coordinator owns Cloud Run executions, credentials, deployments, and schedule activation. The acceptance utility never invokes gcloud. Ensure the deployed gateway, cloudlink, Ask and job image digests and migration certification are recorded before testing. Keep the Ask model disabled for the first pass.

Run from `apps/cloudlink` in the reviewed checkout after frozen installation. Create a private directory (`umask 077`, `mkdir`) outside the repository. Set paths to files that do not exist:

```sh
ACCEPTANCE_SQL_EXPORT=/private/path/provision.json pnpm exec tsx scripts/acceptance.ts provision /private/path/fixture.json staging
```

The manifest contains device and two short-lived session tokens; mode is 0600. The SQL bundle contains **only their SHA-256 hashes**, synthetic IDs and parameterized statements. Preparation says `prepared_not_executed`; it is not provisioning evidence. Do not put the manifest into logs, GitHub, environment overrides, or job arguments. An uncertain transaction outcome retains the manifest for cleanup.

The coordinator executes the parameterized statements in their existing order on a checked-out `pg` client inside the explicitly targeted VPC/job environment (for example an authorized registry-load execution override with the reviewed immutable DB image). Pass each `{text, values}` to `client.query(text, values)`; do not interpolate values into SQL. Require COMMIT success, close the client and record execution ID/status. Do not use db-migrate for fixture work: a diagnostic migration execution would affect release certification. The coordinator must verify target project/image/job before execution; the bundle's environment label is not a database authentication control.

Alternatively, provision directly with the same command **without** `ACCEPTANCE_SQL_EXPORT` and with `DB_*` configured through an authorized loopback Cloud SQL proxy. The utility rejects non-loopback database hosts and execution inside Cloud Run. A laptop without VPC reachability cannot use a private-IP SQL proxy merely by authenticating it.

Fixture authentication creates 2-hour hashed sessions for two synthetic tenants. This tests deployed cookie validation and membership isolation, **not** sign-in email delivery. Separately exercise request-code/verify with an authorized mailbox and check `/v1/me`; do not log email codes or session cookies.

## Staging sequence

```sh
pnpm exec tsx scripts/acceptance.ts ingest /private/path/fixture.json staging
# Coordinator runs the deployed telemetry-rollup job and waits for success.
pnpm exec tsx scripts/acceptance.ts verify /private/path/fixture.json staging
pnpm exec tsx scripts/acceptance.ts ask /private/path/fixture.json staging
```

`ingest` sends a sample of 20, repeats the packet, then sends an older sample of 10. It also verifies a wrong device token is rejected. `verify` requires two sorted raw points, latest remaining 20, completed minute rollups with total count two, unauthenticated 401 and cross-tenant 404. `ask` checks the same authorization boundaries and requires an answer with mean 15 and two readings. It sends only **one** authorized question per invocation and emits its correlation ID rather than answer/prompt text. Do not retry blindly: each invocation is another durable reservation and, when enabled, potentially another paid provider request.

The window is fixed when preparing the manifest. Ingest promptly (within the supported ingest age limit) and finish while fixture sessions remain valid. Use a fresh fixture for a subsequent rollout. Redirects are forbidden; only the exact staging/production HTTPS origins are allowed; response reads and requests are bounded.

## Model and accounting evidence

After the disabled-model pass, inspect fixture-attributed `telemetry.sensor_ask_requests` with a read-only VPC execution. Select only request_id, outcome, model, model_attempted, usage_known, token counts and cost_usd with **all three** tenant_id/actor_id/device_id predicates from the manifest. The utility's `audit` phase performs that query when an authorized loopback SQL connection is available. It reports evidence; it does not itself certify a model result.

For the disabled pass require evidence_only, model_attempted=false and known zero usage. Then enable the reviewed small-model configuration under the agreed provider budget and send one further `ask`. Require the new request ID to have outcome=model, the configured small model, model_attempted=true, usage_known=true and populated nonnegative counts/cost. A successful HTTP response alone can be fallback and is not model acceptance. Unknown usage or a fallback is a failed provider-acceptance gate, not zero spending. Correlate sanitized `llm_call` logs and check alert delivery separately.

Quota/admission failure testing belongs in staging with a separately isolated quota fixture and model disabled. Do not exhaust global/tenant reservations in production or interpret this one-question smoke as distributed quota/load certification. Local PostgreSQL tests cover reservation concurrency; staging load/SQL capacity and missed-job/latency alerts remain separate acceptance gates.

## Cleanup and production smoke

Repeat provision → ingest → rollup → verify → one Ask for production with `prod`, retaining a separate manifest and reviewed production image IDs. Avoid synthetic load or deliberate quota exhaustion in production.

```sh
ACCEPTANCE_SQL_EXPORT=/private/path/cleanup.json pnpm exec tsx scripts/acceptance.ts cleanup /private/path/fixture.json staging
```

Execute this bundle in the same targeted VPC context. It revokes only fixture session hashes and the device with the matching tenant/run marker. It does **not** delete telemetry, users, tenants or durable model accounting. Verify revocation by rerunning authenticated reads (expect 401) and checking the device revoked_at in SQL; record cleanup execution. Remove local secret manifests after evidence and revocation are confirmed. Apply the normal telemetry retention policy to synthetic data; ledger pruning remains a separately reviewed policy.

Record environment, UTC times, reviewed source and image digests, fixture run ID, phase statuses, job execution IDs, Ask request IDs, known/unknown usage, and cleanup outcome. Never record raw tokens, database passwords, prompts or response bodies. Passing this harness does not establish flashed hardware, physical readings, email delivery, SSE, model interpretation quality across arbitrary questions, or full production load capacity.

## Bounded staging failure and admission checks

After baseline ingestion, `load FIXTURE staging` sends exactly 30 ingest requests in three batches of ten concurrent requests, using existing duplicate/backfill packets and wrong device tokens. It reports only status counts, requires accepted and unauthorized responses, and accepts explicit 429/503 overload responses; network/unexpected statuses fail. This is a small admission smoke, not throughput certification. Run `verify` afterward to confirm duplicate count and latest correctness remain unchanged. No model traffic is generated. Production rejects this phase.

For the durable actor quota, use **a separate unused staging fixture** prepared with `ACCEPTANCE_PURPOSE=quota`. The coordinator must inspect the deployed Ask actor limit and disabled model configuration first. This harness only supports a verified limit between 1 and 20; it must match the live configuration. Supply that value as `ACCEPTANCE_ACTOR_LIMIT`, plus the actual `ACCEPTANCE_TENANT_LIMIT` and `ACCEPTANCE_GLOBAL_LIMIT` (strictly greater than actor and tenant respectively). Set `ACCEPTANCE_MODEL_DISABLED=verified` only after inspecting the actual deployed configuration. These are operator attestations, not configuration discovery. Seed and audit acquire the same global advisory lock as Ask and require remaining tenant/global headroom in the current 24-hour window. The live rejection event uses global → tenant → actor precedence, so actor scope independently establishes other headroom at the actual serialized rejection.

1. Provision the quota fixture using its exported SQL bundle.
2. Export `quota-seed` with `ACCEPTANCE_SQL_EXPORT`, the verified limit and disabled-model attestation. Execute it in the same VPC context. It refuses any existing actor reservations, then inserts exactly the configured number of failed, known-zero, no-model fixture reservations in one transaction. This intentionally consumes that many staging global/tenant reservation slots for 24 hours; record the test window and avoid other load until capacity is confirmed.
3. Run `quota-check` once with `ACCEPTANCE_QUOTA_REQUEST=/private/path/request.json` pointing to a new file. The gateway must return 429; the utility saves its `x-request-id` correlation and reports **unproven_requires_durable_event**, exiting **2**. A generic denial is deliberately not a passing actor-quota gate: admission BUSY can occur before reservation. Do not blindly retry.
4. The coordinator retrieves Cloud Logging JSON for that exact request ID, event `sensor_ask_quota_rejected`, `resource.type=cloud_run_revision`, service `ask`, and the expected project. Save the unmodified structured entry array privately. Run `quota-confirm` with the same `ACCEPTANCE_QUOTA_REQUEST` and `ACCEPTANCE_QUOTA_PROOF=/private/path/entries.json`. It requires exactly one matching event with `scope=actor` from the expected resource/project. Missing evidence, another scope, or a mismatched request remains a failure. The file must come from the coordinator's authenticated Cloud Logging query; schema validation does not authenticate a manually authored JSON artifact. Ask emits only event, request_id and scope after a serialized durable rejection, without question, tokens, tenant or device data. Admission denial emits no such event.
5. Export and execute `quota-audit` with the same limit/attestation. SQL asserts the actor still has exactly the seeded reservation count, all scoped to its tenant/device, with no model attempts, unknown usage, costs or changed outcomes. A mismatch aborts the transaction. This is additional no-spend/headroom evidence; it cannot substitute for the correlated actor event. Quota acceptance requires both `quota-confirm` and this SQL audit.
6. Revoke the quota fixture using `cleanup`; retain accounting rows. Do not reset the ledger to bypass limits.

After each fixture cleanup, `verify-cleanup` requires both sessions and the revoked device token to return 401. This exercises controlled credential failure without stopping services or disrupting real traffic. Database-outage/readiness failover remains a separate isolated fault exercise; this harness does not change IAM, kill connections, stop services or pretend credential rejection proves database recovery.
