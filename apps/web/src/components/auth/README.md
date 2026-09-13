# src/components/auth/

`EmailCodeCard` — the three-step sign-up/sign-in card (ADR 0008): email → the six code boxes → done. The boxes are drawn over one real input, so paste and one-time-code autofill work. It calls `requestSignInCode` and `verifySignInCode` from [`src/actions/auth.ts`](../../actions/auth.ts); `intent` switches the copy between `/signup` and `/signin`. In mock mode any 6 digits verify. Relaying gateway's session cookie in live mode is a TODO in the action.
