# Device chat

`POST /v1/devices/:id/chat` — a multi-turn conversation about one device's own
stored readings, beside its plots on `/live/[deviceId]`.

**Disabled by default.** `CHAT_ENABLED` on the Ask service and
`device_chat_enabled` in Terraform both default false, and the route answers
`503` until a chat client is configured.

Distinct from [`SENSOR-ASK.md`](SENSOR-ASK.md), which documents
`POST /v1/devices/:id/ask`. That route is unchanged and stays as it is.

| | `/ask` | `/chat` |
| --- | --- | --- |
| Shape | one question, one answer | multi-turn, history replayed by the browser |
| Model | `claude-haiku-4-5` | `claude-sonnet-5` |
| What the model does | classifies into one of six intents | chooses queries, then narrates their results |
| What reaches the person | a rendered template; no model text, ever | the model's own words |
| Scope | one channel and window, chosen in the UI | whatever windows the model reads, within bounds |
| Calls per turn | 1 | up to `CHAT_MAX_ITERATIONS` (5) |

## Why it is safe to let the model write

The [core rule](CLOUD-PLATFORM.md#22-models-propose-and-narrate-they-never-compute)
is unchanged: **models propose queries and narrate results; they never compute
them.** Every number in a reply is produced by SQL this service ran. The model
picks the window and the wording; it never does the arithmetic, and it is never
handed a raw series to summarise.

That is why `/ask` could get away with never showing model text and `/chat`
can afford to. The constraint moved from *the output is a template* to *the
figures came back from a query* — and each reply carries the queries it was
written from, so the claim is checkable in the UI.

## The tool surface

Four tools, all `strict: true`, all bound to one device:

| Tool | Reads |
| --- | --- |
| `list_channels` | channels, units, latest stored value, retention boundary |
| `device_status` | online/offline/never-seen, last upload, interval, battery, signal, health codes |
| `query_window` | count, min, max, sample mean and latest over a half-open `[from, to)` on one channel |
| `query_series` | pre-computed 1m or 1h buckets, for trend and shape questions |

**There is no tenant or device parameter on any of them.** Scope is closed over
from the request the gateway assembled from the session, so the model has no
vocabulary for another tenant's data. A tool call that carries its own
`tenant_id` is refused by the executor's strict parse before the store is
touched (`converse.test.ts`).

Bounds are enforced in the executor, never in the prompt: 20,000 raw rows per
window, 200 buckets per series, 32 days per call. A model asking for more gets
an error result and may try a narrower window.

## Context

The device's own facts — channels with units, latest values, status, health,
retention boundary and the current time — are assembled server-side and sent as
the **cached system prefix**, not repeated in each question. They come from the
registry via the device's provisioned channels, which is the same invariant as
everywhere else: nothing about a part is hard-coded here.

## What happens when it fails

The turn falls back to a deterministic summary of the device's latest values.
**Model text is never forwarded on a failure path.** Failure classes:
`max_iterations`, `refusal`, `max_tokens`, `no_text`, `provider_error`, plus the
caller's deadline. Each is logged as `device_chat_incomplete` with a closed
reason, never a raw error message.

`mode` on the response says which happened: `model` (written over executed
queries), `no_tool` (the model answered without reading anything — shown, but
labelled in the UI), `unavailable` (the deterministic summary).

## Cost and limits

A chat turn is several frontier calls where an ask turn is one small one, so it
is metered separately and allowed less.

- **Ledger:** `telemetry.device_chat_requests`, one row per request. Not
  conversation history — nothing a person typed is stored anywhere.
- **Admission:** `reserve` runs before any paid call, under its own advisory
  lock. A refused turn costs nothing.
- **Allowances:** 15 per user, 60 per tenant, 120 global, per rolling 24 hours.
- **Cost:** summed across every call in the loop. A loop that ended without a
  metered response, or whose `builds.llm_calls` row failed to write, records
  `usage_known = false` — the spend is real and unknown, and storing zero would
  understate it.
- **Attribution:** one `builds.llm_calls` row per model call, stage
  `device_chat`, which the Usage dashboard shows as its own line.

A spent allowance answers `429 DAILY_LIMIT`, which the panel reports as a limit
rather than advising a retry that cannot succeed. A busy service answers
`429 BUSY`. The gateway tells them apart by reading the upstream `code` only —
a two-value enum, bounded and strictly parsed — never its message.

## Verifying it

- `pnpm --filter ask test` — the loop, the tool executors and the ledger
  against fakes and a disposable PostgreSQL.
- `pnpm --filter ask smoke:live` — one real turn against the API and a local
  database, seeding its own device. **Spends money; never runs in CI.** It
  prints every tool call with the window the model chose, which is the part
  unit tests cannot check: whether the windows are sensible, whether five
  iterations is the right cap, and what a turn actually costs.

## Not built

Streaming (the panel waits for a complete reply), conversation persistence (a
reload starts over), and any write path — the model cannot change a device,
create a rule, flash firmware or send a command, and says so when asked.
