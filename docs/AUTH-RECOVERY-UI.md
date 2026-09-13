# Email-code recovery UI (A5)

The existing `EmailCodeCard` remains the shared `/signup` and `/signin` flow. Gateway still issues codes and sessions, performs anonymous-build claim, and relays secure cookies through the existing session client. This slice changes recovery presentation and transports retry metadata; it does not change authentication policy or mint credentials in the browser.

## Delivered behavior

- Successful sends start **local 30-second resend pacing**. This is a UI courtesy, not a server-provided validity/deadline. Code lifetime remains the gateway's documented ten minutes; the UI does not invent a per-code expiry timestamp or display a false expiry countdown.
- A backend HTTP 429 preserves a parsed `Retry-After` value through transport, API error and Server Action as optional `retryAfterSeconds`. Integer delay seconds and IMF-fixdate HTTP dates are supported. Malformed, negative, fractional, unrepresentable or more-than-one-year delays are omitted, showing a safe wait message without a fabricated deadline. Arbitrary API body details are not used as timing or user-facing copy. Non-JSON intermediary 429 responses preserve this safe metadata as well.
- Code-request and verification cooldowns are separate. Resend pacing does not block verification; a verification limit does not fabricate a resend limit. The backend remains authoritative when it accepts or rejects a later attempt.
- “Change email” returns focus to the email input, clears the entered code and local pacing, and preserves the guarded `next` destination. Actual backend limits remain because a limit can apply to the caller's IP rather than one address. Fields/change-email are disabled during an in-flight action; a synchronous guard prevents duplicate submissions before React's pending render.
- Wrong, expired and exhausted codes remain indistinguishable (`INVALID_CODE`); the UI asks for the latest email or a new code. A resend replaces prior codes. It does not pretend to know which verification condition failed.
- “I already have a code” permits verification after uncertain delivery or request throttling, without sending another email; the email must pass input validation.
- Delivery failures do not falsely say a message was sent; transport failures retain email/code and offer retry. A successful verification still requires the session cookie to have been relayed before navigation. A response lost after successful verification can consume the code; a later invalid result offers another code rather than assuming the previous attempt failed server-side.
- Signup success says the account is ready instead of claiming a greenhouse project was saved. The existing Security destination is labelled accurately rather than presenting it as legal terms.

## Implementation and validation

`lib/api/core.ts` parses only retry metadata; it never exposes raw headers. `actions/auth.ts` converts refusals into fixed messages and optional safe delay seconds. Other action contracts stay unchanged. `EmailCodeCard` keeps cooldowns in memory and derives remaining seconds from deadlines, so delayed timer ticks do not lengthen a cooldown. Reloading/remounting can reset local UI pacing; it does not bypass gateway rate limits.

Tests cover integer/date/malformed Retry-After, JSON and non-JSON 429 propagation, sanitized action messages, local/server pacing, independent send/verify waits, editing email and destination preservation, duplicate submits, entered-value recovery, and generic success copy. Existing session-cookie/anonymous-claim tests remain applicable. Browser integration and actual issuance are coordinated separately with the browser-validation workstream; no provider or production deployment is performed by this slice.
