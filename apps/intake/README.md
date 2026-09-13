# apps/intake/

Ask → spec, the first stage of the pipeline ([ARCHITECTURE.md](../../docs/ARCHITECTURE.md) §7.1, [ASK-TO-ENCLOSURE.md](../../docs/ASK-TO-ENCLOSURE.md) §3). A person describes a device; intake asks at most two rounds of questions, and only questions that change which parts are needed; then it produces a settled `Spec` for the matcher. Claude understands and explains; code decides.

Fastify and zod, deployed as the Cloud Run service `intake` with **internal ingress**. Gateway calls it with an ID token and Cloud Run's IAM check admits it, so intake has no auth code of its own.

## Routes

| Route | Answers |
| --- | --- |
| `POST /v1/turns` `{ build_id }` | Answers the build's latest user message if nothing has answered it: `200 { message_id, spec_version, status }`. `200 { noop: true }` when the latest message already has a reply or another call is answering it. `404` for an unknown build, `400` for a body without a uuid `build_id`, `503` when the database is unavailable |
| `GET /healthz` | `200`. Never touches the database |
| `GET /readyz` | `200` when `SELECT 1` answers within 2 s, otherwise `503` |

Request and response schemas are `IntakeTurnRequest` and `IntakeTurnResponse` in [`@albusforge/schema`](../../packages/schema/src/spec.ts). Errors use the API error shape.

## A turn

`POST /v1/turns` is synchronous and writes everything before it returns:

1. **Lock.** `pg_try_advisory_lock(424200001, hashtext(build_id))` on a dedicated connection. A caller that can't take it returns `noop`: the holder answers. The holder checks for an unanswered message again after unlocking, so a message sent mid-turn is picked up rather than stranded (at most three turns per call).
2. **Read** the transcript, the latest spec version, and how many versions asked questions (`jsonb_array_length(open_questions) > 0`). The build goes to `specifying`.
3. **Scope filter** (`src/policy.ts`) on the latest user message: weapons and harm, mains voltage, medical monitoring, covert tracking. A rule match replies `OUT_OF_SCOPE` for that category with no model call. The rules are narrow on purpose; anything they miss meets the extract prompt's boundaries and the model's own refusals.
4. **Model call** through `callStructured` (`@albusforge/llm`), under a 45 s deadline covering retries. The system prompt (`prompts/extract.v1.md`) and the part catalogue are the cached prefix. The transcript follows as user and assistant turns, then a `role: "system"` message (`prompts/turn.v1.md`) carrying the rounds used and the current spec. The person's words appear only in user turns.
5. **Decide** (`src/decide.ts`, pure):
   - merge `spec_patch` into the spec: sections field by field, arrays replaced
   - drop capability ids and environment flags that aren't in the catalogue, and note each one in `assumptions`
   - keep a question only if its field is on the interim solver-relevant list (`sense.what`, `act.what`, `power.source`, `connect.transport`, `power.target_life_days`, `environment.flags`), one per field, at most three
   - after two asking rounds, or once settled, keep none and add an assumption for each question dropped
   - **settled** = at least one capability and no questions kept
   - use the model's reply only if every question it asked survived; otherwise code writes the reply
6. **Write**, in one transaction: exactly one assistant message, a new `specs` version when the spec changed or questions were asked, and `builds.status`: `asking` with questions, `planning` when settled. The reply's `created_at` is the answered message's plus 1 µs, so each reply sits directly after the message it answers.

Every failure still writes one assistant message:

| Outcome | Reply | Spec |
| --- | --- | --- |
| scope rule | "outside what Albus Forge builds", by category | unchanged |
| model refusal | out-of-scope reply | unchanged |
| token ceiling reached | the conversation limit message; no model call | unchanged |
| deadline, invalid output twice, truncated twice, API error, any exception | "Sorry, could you say that another way?" | unchanged |

On those the status goes back to `asking`, or stays `planning` for a settled spec. If the final write fails (the database is down), nothing is written and the call is a `503`; gateway retries, and the turn is answered once.

The part catalogue comes from `registry.parts`, rendered by `@albusforge/registry/catalogue` and cached for 10 minutes. It holds active parts only, plus drafts when `REGISTRY_INCLUDE_DRAFTS=true`. Every MVP part is a draft today, so without that flag the catalogue is empty and nothing settles.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Cloud Run sets it |
| `LLM_PROVIDER` | `anthropic` | `vertex` isn't implemented and fails at startup |
| `LLM_MODEL` | required | `claude-opus-5` on staging and prod |
| `LLM_EFFORT` | `medium` | `output_config.effort`: `low`, `medium`, `high`, `xhigh`, `max` |
| `ANTHROPIC_API_KEY` | required for `anthropic` | Secret Manager. Never logged |
| `REGISTRY_INCLUDE_DRAFTS` | `false` | `true` on staging: draft parts join the catalogue |
| `LLM_BUILD_TOKEN_CEILING` | `300000` | per-build total tokens (input, output, cache reads and writes) before turns get the limit reply |
| `TURN_DEADLINE_MS` | `45000` | the whole turn, retries included |
| `DB_*` | see [packages/db](../../packages/db/README.md#environment) | `DB_USER=albus_app`. Required at startup |
| `DB_CONNECT_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS`, `DB_IDLE_TIMEOUT_MS` | `5000`, `10000`, `30000` | as in [gateway](../gateway/README.md#environment) |
| `GOOGLE_CLOUD_PROJECT` | unset | enables the `logging.googleapis.com/trace` field |

## Logs

JSON lines on stdout, in gateway's format (`src/log.ts` is a copy of gateway's; a shared package can replace both). Each request gets a `request completed` line, except successful health checks. Each turn gets `turn answered` with the outcome. Each model call gets the `llm_call` spend line described in [packages/llm](../../packages/llm/README.md#metering). Fallbacks, dropped vocabulary and unstored calls log a `WARNING` or `ERROR`. Message text, prompts, the key and the password are never logged.

## Run it

```sh
docker compose up -d postgres
DB_HOST=localhost DB_NAME=albus DB_USER=albus_migrate DB_PASSWORD=albus_migrate DB_SSL=disable \
DB_APP_ROLE=albus_app DB_APP_PASSWORD=albus_app pnpm --filter @albusforge/db db:migrate
DB_HOST=localhost DB_NAME=albus DB_USER=albus_app DB_PASSWORD=albus_app DB_SSL=disable \
  pnpm --filter @albusforge/registry load

DB_HOST=localhost DB_NAME=albus DB_USER=albus_app DB_PASSWORD=albus_app DB_SSL=disable \
LLM_MODEL=claude-opus-5 ANTHROPIC_API_KEY=… REGISTRY_INCLUDE_DRAFTS=true \
  pnpm --filter intake dev
```

### Live smoke

`scripts/live-smoke.ts` runs one ask end to end against the real API and a local database, and prints each reply, the spec, and every call's tokens and cost. It spends money and refuses to run with `CI` set. `--record DIR` saves each model response as a fixture.

```sh
DB_HOST=localhost DB_NAME=albus DB_USER=albus_app DB_PASSWORD=albus_app DB_SSL=disable \
ANTHROPIC_API_KEY=… LLM_MODEL=claude-opus-5 \
  pnpm --filter intake smoke:live --answer "Battery, and it should last a few months"
```

## Tests

`pnpm --filter intake test`. `handler.db.test.ts` needs Docker (for Colima, see [packages/db](../../packages/db/README.md#tests)). Model responses are always replayed fixtures (`test/fixtures/`).

- `test/golden.test.ts`: the three golden builds (fridge monitor, presence alert, plant waterer) through the real turn logic. Each asks one question, about the power source, then settles with every capability the build requires. Also checks that the prefix is cached and identical across turns, and that off-menu capabilities and irrelevant questions are dropped
- `src/handler.db.test.ts`, against Postgres:
  - writes: messages, spec versions, status, and `llm_calls` with tenant or anonymous attribution
  - idempotent noop; three concurrent calls writing one reply
  - a message sent mid-turn still gets answered
  - the deadline, including work that ignores the abort signal, writing exactly one fallback message
  - the token ceiling, a scope refusal, the round cap, a model refusal and a provider failure
- `src/decide.test.ts`: patch merge, vocabulary checks, question filtering, the round cap and settling
- `src/policy.test.ts`: every scope category, plus phrasings that must stay allowed
- `src/app.test.ts`, `src/config.test.ts`, `src/prompts.test.ts`, `src/log.test.ts`

## Deploy

[`deploy-intake.yml`](../../.github/workflows/deploy-intake.yml) runs on pushes to `main` that touch intake, `packages/` or `registry/`. It builds the image once per commit, checks staging freshness, deploys `intake` by digest, and tags the digest `staging-deployed-<commit>` once the scripts confirm staging serves it. [`promote-intake.yml`](../../.github/workflows/promote-intake.yml) deploys that digest to prod, and only if it carries the marker. Neither runs database jobs: intake's tables come from gateway's `db-migrate`, so promote gateway first when intake depends on a new migration. Terraform owns the service, its env and its secret (ADR 0005).

`Dockerfile` builds from the repo root (`docker build -f apps/intake/Dockerfile .`). The image holds `dist/server.js` (one esbuild bundle) and `prompts/`.
