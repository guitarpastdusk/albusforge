# src/actions/

Server Functions (`"use server"`) that Client Components call for interactive API writes. Each one:

- takes **`unknown`** arguments and validates them at runtime with `@albusforge/schema` / zod (trimming inside the string schema), inside `try` — a direct POST with `null`, a number or an object gets the documented validation result, not a server error;
- calls gateway through [`lib/api/server.ts`](../lib/api/server.ts) — so `API_MODE`, the internal ID token and the allowlisted `__Host-` cookies apply — using `sessionClient()` for writes that can change credentials, which relays `__Host-albus_session` / `__Host-albus_anon` to the browser;
- returns a result value instead of throwing; a failure is logged once, with the request's trace, by `lib/action-errors.ts`. No credential is ever returned or logged.

| File | Routes |
| --- | --- |
| `builds.ts` | `POST /v1/builds`, `POST /v1/builds/:id/messages`, then polling `GET` the build and its messages until the assistant replies (`waitForReply`, 20 s with backoff); `checkForReply` reads again after a timeout |
| `devices.ts` | `POST /v1/devices/:id/ask` |
| `auth.ts` | `POST /v1/auth/code`, `POST /v1/auth/verify` — success only once the session cookie is set |

Browser code never calls `/v1` directly: in mock mode there is no gateway, and this keeps one path for both modes. Authorization stays with gateway. Closed-loop actions have no write route yet, so the dashboard's toggles are interactive only in mock mode. Tests in `actions.test.ts`; the cookie relay is tested against a gateway stub in `lib/api/session-client.test.ts`.
