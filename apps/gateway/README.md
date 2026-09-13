# apps/gateway/

The API: Fastify and zod, TypeScript. Deployed as the Cloud Run service `gateway`, which the load balancer sends `/v1` and `/v1/*` to on every host ([ADR 0007](../../docs/adr/0007-portal-routing.md)). Response shapes come from [`@albusforge/schema`](../../packages/schema/), and every response is validated against them on the way out. Data comes from [`@albusforge/db`](../../packages/db/).

M1 added health checks and the parts registry. M2 adds the anonymous chat: start a build from an ask, talk to intake, and stream replies.

## Routes

| Route | Answers |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok"}`. Never touches the database |
| `GET /readyz` | `200` when `SELECT 1` answers within 2 s, otherwise `503` |
| `GET /v1/parts?status=&category=` | `PartList`: the highest SemVer version of each part among versions whose status matches, sorted by id, without blocks |
| `GET /v1/parts/:id?status=` | `PartDetail`: every block of that version, or `404` |
| `POST /v1/builds` | `{ ask_text, client_message_id? }` → `201 CreatedBuild` (below). Sets the anonymous owner cookie when the request has no valid one |
| `GET /v1/builds/:id` | `BuildDetail` with `status`, `spec_version`, `spec` and `candidate_parts` |
| `GET /v1/builds/:id/messages` | `MessageList`, oldest first |
| `POST /v1/builds/:id/messages` | `{ text, client_message_id }` → `202 { message }`; `200 { message }` for a repeated `client_message_id` |
| `GET /v1/builds/:id/events` | `text/event-stream`: `message.created`, `build.updated` |
| `GET /v1/builds` and any other `/v1` path or method | `501 {"error":{"code":"NOT_IMPLEMENTED",…}}` |
| anything else | `404 {"error":{"code":"NOT_FOUND",…}}` |

`status` is comma-separated or repeated (`?status=active,draft`) and defaults to every status except `retired`. The filter applies before "latest": with `?status=active`, a part whose newest version is a draft shows its newest active version. An unknown query parameter, status or category is a `400` with `details`.

Every error, including the 501 and 404, uses the API error shape `{ error: { code, message, details? } }` (ARCHITECTURE.md §6) as JSON, so the portal can tell a gateway answer from an HTML page. A `500` carries only the request id; the error itself goes to the log.

Reads use the registry's SemVer comparator (`@albusforge/registry/semver`), not string order, so `1.10.0` beats `1.9.0` and a release beats its pre-release.

The SSR contract in ADR 0007 (`X-Albus-Internal-Auth` and the forwarded host and client IP) isn't implemented yet. Nothing depends on the tenant yet, and the chat rate limits key on the anonymous owner, not the client IP.

## Builds and chat (M2)

### Ownership

`POST /v1/builds` without a well-formed `__Host-albus_anon` cookie creates a random 32-byte token and sets `__Host-albus_anon=<token>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`. The build stores `anon_owner_hash = sha256(token)` as hex. The token is never stored or logged. A valid cookie is reused, so one browser's builds share a hash.

Every other build route loads the build only when it is unclaimed (`tenant_id` null) and its hash matches the cookie's. Anything else is a `404 NOT_FOUND`, never a 403: no cookie, someone else's build, a claimed build, an unknown or malformed id. So ids can't be probed. Claimed builds and sessions arrive with sign-in ([ADR 0008](../../docs/adr/0008-sign-in-by-email-code.md), [0009](../../docs/adr/0009-tenant-created-at-sign-up.md)).

SSR server actions call gateway on the visitor's behalf, so web has to relay the `Set-Cookie` to the browser and forward the cookie on later calls (ADR 0007).

### Shapes

- `CreatedBuild` = `BuildDetail` plus `build_id` (the same as `id`, kept for `CreateBuildResponse` readers) and a required `status`. A new build is `status: "asking"`, `spec: null`, `spec_version: null`, `candidate_parts: []`, `display_status: "designing"`, `device_count: 0`, `ready: null`. `name` is the ask's first line, cut to 60 characters; `description` is the ask.
- `BuildDetail.spec` is the latest `builds.specs.data`, passed through as intake wrote it. `spec_version` is its version.
- `BuildDetail.candidate_parts` is **a capability match, not a solved plan**. It lists the registry parts whose `software.capabilities` intersect the latest spec's `capabilities`, each with its sorted `matched_capabilities`, sorted by id. No wiring, power, conflict or quantity check has run; M3's matcher replaces it. Only `active` parts are considered unless `REGISTRY_INCLUDE_DRAFTS=true` (every committed part is a draft today). Gateway reads `capabilities` through a small local reader (`src/candidates.ts`) until `Spec` lands in `@albusforge/schema` with m2/intake.
- `ChatMessage` = `{ id, role, text, created_at, client_message_id }`.

### Turns

After storing the first message (`POST /v1/builds`) or a new user message, gateway answers the client and then calls intake in the background: `POST {INTAKE_URL}/v1/turns { build_id }`. Intake writes the assistant message, spec versions, build status and `llm_calls` itself. Gateway runs with CPU always allocated, so the call outlives the response.

- Each attempt has one 50 s deadline covering the ID token and the HTTP call together; intake's own deadline is 45 s. The Google metadata client has no timeout of its own on Cloud Run. When the deadline passes, the scheduler releases the build at once, and a token or answer that arrives late is dropped.
- A network error or a 5xx is retried **once**, after 5 s, and logs `intake turn attempt failed; retrying` at WARNING. A 4xx, a malformed answer or a timeout isn't retried: after a timeout intake may still be running that turn. A turn that still fails logs `intake turn failed` at WARNING. Nothing from a background turn can crash the process.
- **Recovery.** When `GET /v1/builds/:id` or `GET /v1/builds/:id/messages` finds that the newest message is a user message unanswered for more than 60 s, it starts a background turn and logs `recovering an unanswered turn`. This happens at most once per build per 60 s on each instance, tracked in memory, and never while a turn for that build is running there. So the portal's "Check for a reply" refetch recovers a lost turn without a resend. Intake is idempotent and answers `noop` if the reply was only slow.
- One turn per build runs at a time per instance. A trigger that arrives mid-turn queues exactly one more run.
- `INTAKE_AUTH=google` sends a Google ID token for audience `INTAKE_URL`, taken from the metadata server through `google-auth-library`'s `IdTokenClient`, which caches it until shortly before expiry. `INTAKE_AUTH=none` sends no `Authorization` header, for local runs and tests.
- With `INTAKE_URL` unset, messages are still stored, and each turn logs a WARNING instead of running.

### Messages

- `client_message_id` (a UUID) is required. `text` (≤ 4000) and `ask_text` (≤ 2000) are trimmed and may not contain control characters other than tab, newline and carriage return (`400`).
- **Admission is one transaction per build.** It locks the build row with `SELECT … FOR UPDATE`, which also re-checks ownership and unclaimed state, then decides in order:
  - a repeated `client_message_id` → the stored message, `200`, no turn;
  - the newest message is a user message under 60 s old, by the database clock → `409 TURN_IN_PROGRESS` (`details: { pending_message_id, retry_after_s }`);
  - otherwise the rate limit, then insert → `202`.

  Concurrent requests on any instance therefore agree: one of several different messages gets `202` and the rest `409`, and retries of one `client_message_id` all get that message, never `409`.
- Message timestamps append monotonically under that lock: the current database clock or the prior maximum plus 2 microseconds, whichever is later. Clock corrections cannot hide a new question behind an earlier reply; the gap also reserves intake's reply slot at the answered user's timestamp plus 1 microsecond.
- After 60 s a new message is accepted, but the portal never needs to resend: see recovery under Turns. Its "Check for a reply" is a refetch.
- On `POST /v1/builds`, a `client_message_id` sent with an existing cookie returns the build already created from it (`200`). The create transaction holds an advisory lock on (owner hash, client message id) and re-checks for that build inside it, so concurrent requests create one build, even across instances.

### Events

`GET /v1/builds/:id/events` polls Postgres every second; there's no Redis yet.

- The first event of every stream is `build.updated` `{ status, spec_version }`, followed by `message.created` `{ message }` for each message after `Last-Event-ID`, oldest first. Later, `build.updated` is sent whenever status or spec version changed since the last one sent; states that come and go between two polls aren't sent. Messages are always oldest first, but **clients must not rely on an order between a status change and a message written independently**.
- Without a valid `Last-Event-ID` the whole transcript is replayed, so clients dedupe by message id.
- **Event ids** are message cursors, `<created_at in integer microseconds since the Unix epoch>.<message uuid>`, ordered like `(created_at, id)`. Treat them as opaque. A `build.updated` repeats the latest cursor sent, so it never moves the resume position.
- Each poll re-reads a 5 s lookback window and skips messages this connection has already sent. That catches a message whose transaction committed after a later one was delivered. Across a reconnect only messages strictly after the cursor are sent, so a `GET …/messages` after reconnecting stays the source of truth.
- A `: ping` comment every 15 s and `retry: 3000`. The stream ends after 10 minutes and the client reconnects with `Last-Event-ID`. Shutdown ends every open stream first.
- A failed poll logs `build events poll failed` at WARNING, with database metadata only, and ends the stream.
- **Authorization holds for the life of the stream.** Both poll queries are scoped to the owner hash the stream opened with and to an unclaimed build. The stream ends at the first poll after the build is claimed (`tenant_id` set, hash cleared), deleted or re-owned, and a message written after a claim is never sent.
- **Admission is bounded.** At most `SSE_MAX_STREAMS_PER_OWNER` (3) open streams per anonymous owner and `SSE_MAX_STREAMS` (100) per instance. Beyond that the answer is `429 RATE_LIMITED` with `Retry-After: 5`, before the stream opens. A slot is released when the client disconnects, the stream ends, or on shutdown.
- **Slow clients are dropped.** While a write is still buffered, polling and heartbeats pause. A client that doesn't drain within 30 s, or whose unsent buffer passes 1 MiB, is disconnected, and `closing slow event stream` is logged at INFO. A reader that drains before the next poll is never made to wait: the `drain` listener is attached as the write buffers, and the next tick tests the socket rather than a latched flag.

### Rate limits

These are held in memory per instance, keyed by the anonymous owner hash: 10 new builds an hour and 30 messages in 10 minutes. Beyond that: `429 RATE_LIMITED` with `Retry-After` and `details.retry_after_s`. They are **defence in depth behind Cloud Armor**. Each instance counts separately and a restart forgets. A replayed `client_message_id` doesn't count.

A request without a cookie always gets a fresh hash, so the per-owner limits can't bound it. As a spend backstop, builds that create a **new anonymous owner** are also capped for the whole instance at `ANON_BUILDS_PER_HOUR` (default 60) in a sliding hour. A new owner is one whose hash no stored build carries yet. That covers a missing cookie and a well-formed but unknown one, so rotating made-up cookies doesn't escape the cap. Beyond the cap it answers the same `429 RATE_LIMITED` with `Retry-After`, and logs `anonymous build cap reached on this instance` at WARNING once per window. An owner who already has a build isn't counted. A per-IP limit waits for the SSR contract to give gateway a trustworthy client IP.

## Run it

```sh
docker compose up -d postgres
# once: migrate and create the app role, then load the registry
DB_HOST=localhost DB_NAME=albus DB_USER=albus_migrate DB_PASSWORD=albus_migrate DB_SSL=disable \
DB_APP_ROLE=albus_app DB_APP_PASSWORD=albus_app pnpm --filter @albusforge/db db:migrate
DB_HOST=localhost DB_NAME=albus DB_USER=albus_app DB_PASSWORD=albus_app DB_SSL=disable \
  pnpm --filter @albusforge/registry load

DB_HOST=localhost DB_NAME=albus DB_USER=albus_app DB_PASSWORD=albus_app DB_SSL=disable \
INTAKE_URL=http://localhost:8081 INTAKE_AUTH=none REGISTRY_INCLUDE_DRAFTS=true \
  pnpm --filter gateway dev          # http://localhost:8080/v1/parts
```

Browsers only send `__Host-` cookies over HTTPS, but curl doesn't enforce that locally.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Cloud Run sets it |
| `DB_*` | see [packages/db](../../packages/db/README.md#environment) | required at startup, even though `/healthz` doesn't use them, so a misconfigured revision fails to start |
| `GOOGLE_CLOUD_PROJECT` | unset | enables the `logging.googleapis.com/trace` field |
| `DB_CONNECT_TIMEOUT_MS` | `5000` | connecting a database client, or waiting for a free one when the pool (5) is full |
| `DB_QUERY_TIMEOUT_MS` | `10000` | server-side `statement_timeout`. The client also gives up on a response that hasn't arrived 1 s after this |
| `DB_IDLE_TIMEOUT_MS` | `30000` | an idle pooled client is closed |
| `INTAKE_URL` | unset | intake's `run.app` URL (internal ingress, reached over direct VPC egress). Unset: messages are stored, turns are skipped with a WARNING |
| `INTAKE_AUTH` | `google` | `google`: an ID token for audience `INTAKE_URL` from the metadata server. `none`: no `Authorization` header (local, tests) |
| `REGISTRY_INCLUDE_DRAFTS` | `false` | `true`: `candidate_parts` considers draft parts as well as active ones |
| `ANON_BUILDS_PER_HOUR` | `60` | builds that create a new anonymous owner (no stored build has its hash), per instance per sliding hour |
| `SSE_MAX_STREAMS_PER_OWNER` | `3` | open event streams per anonymous owner, per instance |
| `SSE_MAX_STREAMS` | `100` | open event streams per instance |

An empty variable counts as unset.

### Database timeouts

Every database wait is bounded, so a stalled database can't hold the pool:

- A handshake that never completes, or a full pool, fails after `DB_CONNECT_TIMEOUT_MS`.
- A statement that runs too long, including one blocked by a lock, is cancelled by Postgres after `DB_QUERY_TIMEOUT_MS` (SQLSTATE 57014).
- A response that never arrives, such as over a connection that died silently, fails on the client 1 s later.

pg-pool destroys any client whose query failed rather than returning it to the pool, so a timed-out connection is never reused. Each of these failures, and a refused or dropped connection, answers `503 {"error":{"code":"UNAVAILABLE",…}}` and logs one `database unavailable` WARNING with the pg error. The log leaves out Drizzle's wrapper, which carries the SQL and its parameters. `timeouts.db.test.ts` checks all three cases, and that the pool serves requests again afterwards.

Each open event stream runs two short queries a second against the 5-client pool.

Terraform also sets `PUBLIC_DOMAIN` and `SSR_SERVICE_ACCOUNT`, for the SSR contract; nothing reads them yet.

## Logs

One JSON object per line on stdout, in the shape Cloud Logging parses, with the same conventions as the portal ([`apps/web/src/lib/log.ts`](../web/src/lib/log.ts)): `severity`, `message`, and `logging.googleapis.com/trace` from `X-Cloud-Trace-Context` or `traceparent` when `GOOGLE_CLOUD_PROJECT` is set.

- One `request completed` line per request: `requestId`, `method`, `route` (the pattern), `path` (no query string), `status`, `durationMs`. Successful health checks aren't logged.
- `request failed` at `ERROR` for every 500, with the serialized error.
- `intake turn completed` (INFO) or `intake turn failed` (WARNING), with `buildId`, `requestId`, `durationMs` and, on failure, `intakeStatus`.
- Request ids are always generated (UUID) and returned as `X-Request-Id`; an incoming `X-Request-Id` is ignored.
- A database error that isn't an availability failure logs `request failed` at `ERROR` with only a `database` object: SQLSTATE `code`, `severity`, and where available `schema`, `table`, `column`, `constraint`, `routine`. Its message and stack aren't logged, because Drizzle's wrapper carries the SQL parameters and pg's message can quote input (`src/db-log.ts`).
- Never logged: headers, cookies (including the anonymous owner token), query values, bodies, message text, SQL parameters, `DB_PASSWORD`.

## Shutdown

On `SIGTERM` or `SIGINT` the server ends open event streams, stops accepting connections, finishes in-flight requests, closes the database pool and exits. If that takes more than 8 s (Cloud Run allows 10), it exits with status 1. A background intake turn still running is abandoned; the next message starts it again.

## Layout

| Path | What it is |
| --- | --- |
| `src/server.ts` | the process: config, pool, intake client, listen, signals |
| `src/app.ts` | `buildApp`: hooks, error and not-found handlers, health and parts routes |
| `src/build-routes.ts` | the build, message and event routes: ownership, idempotency, 409, rate limits |
| `src/chat-store.ts` | `ChatStore` over `builds.builds`, `build_messages` and `specs`; message cursors |
| `src/sse.ts` | the polling event stream |
| `src/intake.ts` | intake HTTP client, ID token auth, background turn scheduler |
| `src/candidates.ts` | capability matching and the local spec reader |
| `src/owner.ts` | the anonymous owner cookie and its hash |
| `src/rate-limit.ts` | in-memory sliding-window limiter |
| `src/http.ts` | `HttpError`, the error shape, request parsing |
| `src/parts.ts` | `PartsStore` over `registry.parts`, and `latestPerId` |
| `src/config.ts` | `PORT`, the database, intake and registry env |
| `src/log.ts` | structured logs and trace parsing |
| `Dockerfile` | production image; build from the **repo root** (`docker build -f apps/gateway/Dockerfile .`) |

`pnpm --filter gateway build` bundles `src/server.ts` and its workspace dependencies into `dist/server.js` with esbuild. The workspace packages are TypeScript source, so bundling is simpler than compiling each one, and the image needs no `node_modules`.

## Tests

`pnpm --filter gateway test`. Needs Docker, as for packages/db (see [its README](../../packages/db/README.md#tests) for Colima). No test reaches Google or Anthropic.

- `app.test.ts`: every route against an in-memory store: health, 501 and 404 fallbacks, query validation, the error shape, and what's logged
- `routes.db.test.ts`: starts `postgres:16-alpine`, migrates with `@albusforge/db`, loads the committed registry with the registry loader as `albus_app`, adds extra versions, and checks SemVer ordering and the status and category filters through the real store
- `chat.db.test.ts`: the build routes against Postgres, with a stub intake server on localhost. It covers cookie issuance and the stored hash, 404s for non-owners on every route, idempotent builds and messages, 409, rate limits, candidate parts with drafts on and off, the background turn and a failing intake (WARNING, still serving), and SSE (a message and a status change after connect, heartbeats, resume from `Last-Event-ID`, the time limit)
- `intake.test.ts`: the HTTP client against a stub server, ID token auth with a fake `GoogleAuth`, and the scheduler's logging, timeout and coalescing
- `parts.test.ts`, `log.test.ts`, `config.test.ts`, `owner.test.ts`, `rate-limit.test.ts`, `candidates.test.ts`: unit tests

## Deploy

[`deploy-gateway.yml`](../../.github/workflows/deploy-gateway.yml) runs on pushes to `main` that touch gateway, `packages/`, `registry/` or the images. It builds two images once per commit, `gateway` and `db-jobs` ([`docker/db-jobs.Dockerfile`](../../docker/db-jobs.Dockerfile)), then in staging:

1. updates the `db-migrate` job to the db-jobs digest and executes it, waiting for success
2. does the same for `registry-load`
3. deploys `gateway` by digest
4. tags both digests `staging-deployed-<commit>`, once the scripts confirm what ran

[`promote-gateway.yml`](../../.github/workflows/promote-gateway.yml) promotes both digests to prod in the same order. Both digests must carry the marker from the same staging commit.

The db-jobs entrypoint picks its task from its first argument (`migrate`, `registry-load`) or, with none, from `CLOUD_RUN_JOB`, the name Cloud Run gives every job task. Terraform owns the jobs' command and args and sets neither, so CI can deploy the image without setting anything else (ADR 0005).

**A failed or cancelled run may already have changed the database.** Each job commits as it goes: migrations apply one by one before the app role is provisioned, and the loader commits its transaction before the job reports success. A later step failing, a cancelled workflow, or a job execution that outlives its cancelled run doesn't undo any of it. Nothing rolls back, and freshness only compares commits; it's not a database rollback. So every migration must be forward-compatible: the gateway revision still serving has to keep working against the new schema until the new revision replaces it, and recovering from a bad migration means another migration that fixes forward.

ADR 0005's rule applies to gateway and both jobs: don't apply their Terraform while `deploy-gateway` (staging) or `promote-gateway` (prod) might run. Disable that workflow first.
