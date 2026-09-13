# src/mocks/

Mock API responses, used when `API_MODE=mock` — set for `next dev` by `apps/web/.env.development`. The server refuses mock mode on Cloud Run.

- `data.ts` — the design prototype's data shaped to `@albusforge/schema`, with timestamps relative to the call.
- `index.ts` — `mockTransport`: matches a request against the route patterns in `@albusforge/schema` and answers from `data.ts`; unknown ids get the real 404 error shape, unmocked routes get 501.
- `mocks.test.ts` — every mock goes through the transport and is parsed by its schema, so a mock can't drift from the contract.

Connecting a screen to gateway means nothing here changes — set `API_MODE=live`.
