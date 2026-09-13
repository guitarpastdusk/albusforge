# src/components/auth/

`EmailCodeCard` — the three-step sign-up/sign-in card (ADR 0008): email → the six code boxes → done. It calls `requestSignInCode` and `verifySignInCode` from [`src/actions/auth.ts`](../../actions/auth.ts) through `settle()`, so a rejected call shows a retryable message and keeps what was typed; `intent` switches the copy between `/signup` and `/signin`.

`CodeBoxes` draws six boxes over one transparent real input, so paste and one-time-code autofill work; while the input is focused, the box the next digit goes into shows a coral ring (`group-focus-within`).

In mock mode any 6 digits verify. Verify succeeds only once gateway's session cookie has been relayed to the browser. Tests in `auth.test.tsx`.

Recovery: a successful send starts local 30-second resend pacing; a backend 429 carries only sanitized `Retry-After` seconds to the component. Sending and verification have separate cooldowns. Changing email clears code/local pacing while preserving real backend limits and `next`. Invalid/expired/replaced codes share a message; delivery/transport failures preserve input. A synchronous in-flight guard prevents duplicate submissions and fields are disabled until their action settles. See `docs/AUTH-RECOVERY-UI.md` for boundaries and tests.
