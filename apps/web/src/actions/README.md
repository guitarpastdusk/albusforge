# src/actions/

Server Functions (`"use server"`) that Client Components call for interactive API writes. Each one validates its input with `@albusforge/schema`, calls gateway through [`lib/api/server.ts`](../lib/api/server.ts) — so `API_MODE`, the internal ID token and the allowlisted `__Host-` cookies all apply — and returns an `ActionResult` instead of throwing. A failure is logged once, with the request's trace, by `lib/action-errors.ts`.

Browser code never calls `/v1` directly: in mock mode there is no gateway, and this keeps one path for both modes.

| File | Routes |
| --- | --- |
| `builds.ts` | `POST /v1/builds`, `POST /v1/builds/:id/messages`, then `GET` the build and its messages |
| `devices.ts` | `POST /v1/devices/:id/ask` |
| `auth.ts` | `POST /v1/auth/code`, `POST /v1/auth/verify` — relaying gateway's Set-Cookie is a TODO |

Authorization stays with gateway: it scopes every call to the forwarded session or anonymous owner. Closed-loop actions have no write route yet, so the dashboard's toggles are local state only.
