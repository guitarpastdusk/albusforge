# packages/llm/

Model calls for every service that uses Claude ([ARCHITECTURE.md](../../docs/ARCHITECTURE.md) §12.4, [ASK-TO-ENCLOSURE.md](../../docs/ASK-TO-ENCLOSURE.md) §3). One wrapper owns every failure path, so no service parses model text itself.

Consumed as TypeScript source and bundled by the apps.

## `callStructured(route, schema, messages, options)`

Returns `{ ok: true, value }` or `{ ok: false, failure }`. It never throws for a model or API outcome.

1. **Token ceiling.** Reads the build's tokens so far (`options.tokenCeiling.used()`) before every call. At or over the limit: `token_ceiling`, and no call.
2. **Request** on the beta messages API: `client.beta.messages.create` with `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`, `thinking: { type: "adaptive" }` and `output_config: { effort, format }`, where `format` is the zod schema as JSON schema. `options.signal` is the caller's deadline and cancels the request.
3. **Meter first.** Every response is logged and written to `llm_calls` before it's inspected, so refused, truncated and retried calls are all counted. A failed insert calls `onMeterError`; the call carries on.
4. **Branch on `stop_reason`:** `refusal` returns `refusal` (no retry). `max_tokens` retries once with `route.retryMaxTokens`, then returns `max_tokens`. `model_context_window_exceeded` returns `max_tokens`.
5. **Validate** the text blocks with `JSON.parse` and `schema.safeParse`. On failure there's one repair retry: the transcript plus the bad output as an assistant turn and the validation error as a user turn. A second failure returns `invalid_output`.

That's at most three calls. Other results are `deadline` (the signal aborted) and `provider_error` (the SDK's own retries on 408/409/429/5xx are exhausted, or a 4xx). The caller turns each failure into a safe reply.

### Routes and caching

An `LlmRoute` is one kind of call: `system` (a prompt file's text), optional `cachedContext` (intake's part catalogue), `effort`, `maxTokens` and `retryMaxTokens`. The request's `system` is those two text blocks with one `cache_control: { type: "ephemeral" }` breakpoint on the last. Everything per-request goes in `messages`, after the breakpoint. `prefixHash(route)` hashes the prefix. Claude Opus 5's minimum cacheable prefix is 512 tokens.

## Metering

Each call writes one `builds.llm_calls` row (`tenant_id` or `anon_owner_hash` from the caller's attribution, ADR 0009), and one log line to stdout:

```json
{"severity":"INFO","message":"llm call","event":"llm_call","stage":"intake","model":"claude-opus-5","cost_usd":0.032498,"input_tokens":412,"output_tokens":640,"cache_read_input_tokens":0,"cache_creation_input_tokens":2310,"stop_reason":"end_turn","build_id":"…"}
```

With `GOOGLE_CLOUD_PROJECT` set and a trace, `logging.googleapis.com/trace` is added. Infra's log-based spend metric and alert read `jsonPayload.event = "llm_call"` and `jsonPayload.cost_usd`, so don't rename or drop fields. `meter.test.ts` pins the exact line.

`src/pricing.ts` holds the per-model price table (input, 5-minute and 1-hour cache writes, cache reads, output), from <https://platform.claude.com/docs/en/about-claude/pricing>. When a server-side fallback ran, `usage.iterations` prices each model's share at its own rate. A model missing from the table is priced at the most expensive row, and `onUnknownModel` fires.

`buildTokensUsed(db, buildId)` sums input, output, cache-read and cache-write tokens from `llm_calls`. Counting cache reads makes the ceiling conservative; it's an abuse guard, not a bill.

## Providers

`createProvider(LLM_PROVIDER, { apiKey })`:

| `LLM_PROVIDER` | |
| --- | --- |
| `anthropic` | `@anthropic-ai/sdk`, pinned to an exact version. Needs `ANTHROPIC_API_KEY` |
| `vertex` | not implemented: throws `NOT_IMPLEMENTED`, so a service configured for it fails at startup |

The model id is always the caller's (`LLM_MODEL`), never a constant here.

## Tests

`pnpm --filter @albusforge/llm test`. No network and no key.

- `test/call.test.ts`: every `callStructured` branch against recorded-shape fixtures (`test/fixtures/`): valid, refusal, truncation then success, truncation twice, invalid JSON, schema mismatch, repair success, the three-call cap, the token ceiling before the first call and before a retry, the deadline, provider errors, and a failed meter insert
- `test/request.test.ts`: pins the request's field names and types to the installed SDK with `expectTypeOf`, so an SDK upgrade that changes them fails typecheck
- `test/meter.test.ts`: prices, fallback iterations, the exact log line, log-before-insert, and the provider stubs

`src/testing.ts` (`@albusforge/llm/testing`) has `replayProvider`, `recordingProvider`, `hangingResponse`, `memoryMeter` and `fakeResponse`. `createAnthropicProvider` refuses to build a client under vitest, and `test/no-live-calls.ts` fails the run if CI has `ANTHROPIC_API_KEY` set.
