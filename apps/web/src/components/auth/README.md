# src/components/auth/

`EmailCodeCard` — the three-step sign-up/sign-in card (ADR 0008): email → the six code boxes → done. It calls `requestSignInCode` and `verifySignInCode` from [`src/actions/auth.ts`](../../actions/auth.ts) through `settle()`, so a rejected call shows a retryable message and keeps what was typed; `intent` switches the copy between `/signup` and `/signin`.

`CodeBoxes` draws six boxes over one transparent real input, so paste and one-time-code autofill work; while the input is focused, the box the next digit goes into shows a coral ring (`group-focus-within`).

In mock mode any 6 digits verify. Verify succeeds only once gateway's session cookie has been relayed to the browser. Tests in `auth.test.tsx`.
