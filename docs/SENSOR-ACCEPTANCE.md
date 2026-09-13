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
