# packages/llm/test/fixtures/

Model responses in the exact `BetaMessage` JSON shape the API returns, replayed by `replayProvider` (`src/testing.ts`). Tests never call the API.

| File | Branch of `callStructured` it drives |
| --- | --- |
| `valid.json` | `end_turn` with a schema-valid `SpecTurn` (a thinking block, then the JSON text) |
| `refusal.json` | `stop_reason: "refusal"` before any output: no content, zero usage |
| `max-tokens.json` | `stop_reason: "max_tokens"` with truncated JSON |
| `invalid-json.json` | `end_turn` whose text isn't JSON |
| `schema-mismatch.json` | `end_turn` with JSON that fails `SpecTurn` (unknown transport, empty reply) |

These are written by hand in the recorded shape so each branch is deterministic. Real recordings come from `apps/intake/scripts/live-smoke.ts --record` and live in `apps/intake/test/fixtures/recorded/`.
