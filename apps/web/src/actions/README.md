# src/actions/

Server Functions (`"use server"`) that Client Components call for interactive API writes. Each one:

- takes **`unknown`** arguments and validates them at runtime with `@albusforge/schema` / zod (trimming inside the string schema), inside `try` — a direct POST with `null`, a number or an object gets the documented validation result, not a server error;
- calls gateway through [`lib/api/server.ts`](../lib/api/server.ts) — so `API_MODE`, the internal ID token and the allowlisted `__Host-` cookies apply — using `sessionClient()` for writes that can change credentials, which relays `__Host-albus_session` / `__Host-albus_anon` to the browser;
- returns a result value instead of throwing; a failure is logged once, with the request's trace, by `lib/action-errors.ts`. No credential is ever returned or logged.

| File | Routes |
| --- | --- |
| `auth.ts` sign out | `signOut()` — POST /v1/auth/signout, deletes the session cookie (Secure, Path=/) even if gateway fails, redirects to `/` |
| `builds.ts` | `startBuild` (`POST /v1/builds`) and `sendBuildMessage` (`POST /v1/builds/:id/messages`), each with a client-generated `client_message_id` so a retried send is idempotent; they return once gateway accepts, and replies arrive on the event stream. `refreshBuild` reads the build and its messages again (never resends). 409 `TURN_IN_PROGRESS` and 429 `RATE_LIMITED` are "not sent" results, not logged |
| `devices.ts` | `POST /v1/devices/:id/ask` |
| `enclosure.ts` | `loadEnclosureBody` — `GET /v1/builds/:id/body`; 501 and 404 are "no body yet" (`data: null`), so the device-ready card keeps its labelled sample; other failures are logged |
| `auth.ts` | `POST /v1/auth/code`, `POST /v1/auth/verify` — success only once the session cookie is set |

Browser code never calls `/v1` directly: in mock mode there is no gateway, and this keeps one path for both modes. Authorization stays with gateway. Closed-loop actions have no write route yet, so the dashboard's toggles are interactive only in mock mode. Tests in `actions.test.ts`; the cookie relay is tested against a gateway stub in `lib/api/session-client.test.ts`.
