# src/mocks/

Mock API responses, used when `API_MODE=mock` — set for `next dev` by `apps/web/.env.development`. The server refuses mock mode on Cloud Run.

- `data.ts` — the design prototype's data shaped to `@albusforge/schema`, with timestamps relative to the call. It also keeps landing-chat conversations in memory (bounded), answering with the prototype's three scripted replies about 1.5 s after each message (immediately under vitest). Status, spec and candidate parts (registry parts, by capability) progress with the script; after the third exchange the status is `planning` and the device-ready card appears. A replayed `client_message_id` returns the stored build or message (200). Any 6-digit code verifies.
- `rules.ts` — `readRule`: mock mode's deterministic reading of a plain-words rule against the device's channels, standing in for the proposal step gateway will run (ADR 0010). Rules, toggles and proposals live in memory in `data.ts` for the process (`resetActions()` for tests); a proposal with issues is refused with 409 on confirm.
- `index.ts` — `mockTransport`: matches a request against the route patterns in `@albusforge/schema` and answers from `data.ts`; unknown ids get the real 404 error shape, unmocked routes get 501. Chat and device replies wait the prototype's 900 ms / 800 ms (0 under vitest).
- `build-events.ts` — `mockBuildEvents(buildId, signal)`: mock mode's `GET /v1/builds/:id/events`, shaped like gateway's (build.updated, message.created with ids, pings); served by the dev route handler.
- `mocks.test.ts` — every mock goes through the transport and is parsed by its schema, so a mock can't drift from the contract.

Connecting a screen to gateway means nothing here changes — set `API_MODE=live`.

Mock responses carry the same cookies gateway sets — `__Host-albus_anon` on build creation, `__Host-albus_session` (and the anonymous cookie cleared) on verify — so mock mode exercises the Server Functions' cookie relay. The showcase and listings have no mock: they answer 501 like gateway does until those routes are built, so local dev shows the same example builds as staging and prod (`src/lib/example-builds.ts`).

Sessions: mock verify issues `__Host-albus_session=mock-session.<base64url email>`; `mockSession(value)` is mock mode's GET /v1/me for it (anything else is logged out). Sign out clears it.
