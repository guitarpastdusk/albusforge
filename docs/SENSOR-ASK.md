# Sensor Ask service

`apps/ask` is the bounded, single-sensor chatbot backend. It is a separate internal Cloud Run service. It reads accepted telemetry and uses a small hosted model only to classify the user's question into a supported intent. Server code renders all numerical answers from verified evidence. This is an initial implementation of the constrained sensor Ask slice; it is not the broader cross-sensor intelligence/tool loop in CLOUD-PLATFORM §7.4.

## Request and trust boundary

`POST /v1/ask` accepts `SensorAskRequest` from `@albusforge/schema`: `request_id`, `actor_id`, `tenant_id`, `device_id` (UUIDs), `question` (1–2000 characters), `channel`, `from`, and `to`. The interval is half-open `[from,to)`, positive and no longer than 24 hours. The response includes matching request/device/channel IDs, answer, evidence, mode and limitations.

Only gateway's service account may invoke the deployed service using Cloud Run IAM. Ask does not accept browser cookies and does not implement a shared-secret bypass. Gateway must authenticate the opaque user session and derive actor/tenant/device scope; it must not forward client-provided identity. Ask independently checks current tenant membership, device ownership and channel existence before quota reservation and again when reading evidence. Local development binds HTTP without IAM and must stay private. Do not expose this service directly to the public Internet.

Each evidence query uses a read-only repeatable-read PostgreSQL transaction and explicit tenant/device SQL predicates. A parent-table access-share lock is taken before the snapshot to synchronize partition maintenance and retention-watermark changes. Reads are parameterized and return at most 10,001 rows; more than 10,000 accepted samples produces `422 TOO_MANY_POINTS`, never a partial summary. An expired raw interval produces `410 HISTORY_EXPIRED`. Numeric minimum, maximum, incremental sample mean, count and latest sample are computed deterministically. Latest means latest **within the requested interval**, including zero values. Unit comes from the provisioned channel contract. No credentials or provisioning source snapshot are queried.

## Model and behavior

The only permitted configured model is `claude-haiku-4-5`, through the existing Anthropic provider in `packages/llm`. Its dated response ID is also included in the shared pricing table. The provider is constructed with zero retries; there is one request, no adaptive thinking, fallback model, tool loop or repair request. `output_config.format` constrains output to one intent enum: latest, summary, count, min, max or unsupported. The runtime validates the enum again and accepts no model-authored prose, SQL or numbers. The question is the only per-request content sent to the provider; sensor readings and identity are not sent.

[Anthropic's structured-output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) lists Haiku 4.5 support and the `output_config.format` request shape (checked 2026-09-13). Tests use injected provider fixtures and never make a paid model call. Live provider availability and interpretation accuracy still need an explicitly authorized evaluation before enablement.

Unsupported questions receive a description of supported questions. If language interpretation is disabled, refused, malformed or fails, the response explicitly labels a verified window summary as `evidence_only`. Empty history is distinct from zero and does not imply healthy/offline hardware. A model may misclassify intent, but cannot alter the scope, execute code, invent a number or change the evidence. Every response carries the limitations alongside its evidence.

This first slice has explicit channel/window controls, not persisted conversation memory. Questions depending on prior turns, forecasts, anomaly/cause analysis, comparisons across windows/devices, missing-sample inference and device writes are unsupported. Rollups and chart generation are not used for these bounded raw summaries. It does not prove physical sensor operation or deployed device-to-cloud behavior.

## Budgets, attribution and failures

Migration `0004_sensor_ask` adds `telemetry.sensor_ask_requests`. A global transaction-level advisory lock serializes reservations across service instances. A rolling 24-hour request count enforces global, tenant and actor ceilings. Reservations occur after authorization/channel validation and before expensive raw-history reads or model calls. A request UUID can reserve only once; repeats return `409 DUPLICATE_REQUEST` and never charge twice. Failed/aborted requests retain their reservation, conservatively consuming quota. This is not a retry-response cache: gateway should not automatically retry a POST.

Defaults are 20 requests per actor, 100 per tenant and 200 globally per rolling 24 hours. The 2,000-character question, fixed sub-kilobyte prompt, small enum schema and 1,024-token hard output maximum bound each single provider call. At the checked-in Haiku rates, defaults provide a conservative low-single-digit-dollar daily ceiling estimate for Ask; this is not a provider-enforced dollar cap or a budget for other services. Recheck provider prices before raising limits. Unknown response models are priced conservatively by the shared meter and their output is discarded. Provider hard spend limits remain an operational gate.

Successful provider responses are metered before parsing, using shared cost accounting and a structured `event=llm_call`, `stage=ask` log enriched with request, actor, tenant and device IDs. The ledger persists token/cache-token counts, model, estimated cost and outcome. No synthetic build ID, prompt or response text is stored. No SQL connection is held during the provider call. The ledger marks provider dispatch durably before the call. Provider errors without usage persist `model_attempted=true`, `usage_known=false` and null cost/token counts; disabled/no-call completion records known zero. A crash/deadline can leave `reserved` with unknown usage; operators must reconcile those rows against provider billing. Usage logs are the fallback when database completion fails. The ledger is not conversation storage. Retention/pruning of this audit ledger is not yet scheduled; never delete rows younger than 24 hours or quota enforcement changes.

One deadline covers reservation, evidence, model and completion. SQL acquisition has its own 3-second queue/connect bound; statements have 5-second server and 6-second client bounds. Deadline cancellation destroys an in-flight SQL lease, while late acquired leases are discarded. Provider cancellation also has a local race guard, so an ignored abort cannot retain an HTTP concurrency slot. An aborted request can fail with a sanitized 503 instead of an answer; reservations persist. The instance semaphore rejects excess work with 429. Cloud Run concurrency and pool limits should match the infrastructure budget.

## Runtime and validation

| Variable | Default / constraint |
|---|---|
| `PORT` | 8080 |
| Standard `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `DB_SSL` | See packages/db configuration; application role only |
| `DB_POOL_MAX` | 4, maximum 16 |
| `ASK_MAX_CONCURRENCY` | 4, maximum 16 |
| `ASK_DEADLINE_MS` | 20000, maximum 25000 |
| `ASK_MODEL_ENABLED` | false |
| `LLM_PROVIDER` | anthropic only |
| `LLM_MODEL` | required when enabled; claude-haiku-4-5 only |
| `ANTHROPIC_API_KEY` | required secret when enabled |
| `ASK_MAX_OUTPUT_TOKENS` | 512, maximum 1024 |
| `ASK_USER_DAILY_REQUESTS` | 20, maximum 1000 |
| `ASK_TENANT_DAILY_REQUESTS` | 100, maximum 10000 |
| `ASK_GLOBAL_DAILY_REQUESTS` | 200, maximum 10000 |

`GET /healthz` is database-independent liveness. `GET /readyz` checks connectivity and required Ask table existence. Errors do not expose SDK/SQL/configuration messages. Run migrations before deploying the service. Run `pnpm --filter ask test`, `typecheck`, `lint`, and `build`; PostgreSQL tests require Docker (Postgres 16). Build the standalone image with `docker build -f apps/ask/Dockerfile .`. The image runs as a non-root user and supports SIGTERM draining. No deployment, migration against shared infrastructure or model call is part of the test suite.
