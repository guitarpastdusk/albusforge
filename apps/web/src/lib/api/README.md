# src/lib/api/

The gateway client. Every response is validated against `@albusforge/schema`; a non-2xx is validated against the error shape and thrown as `ApiRequestError`.

| File | Use from | What it does |
| --- | --- | --- |
| `server.ts` | Server Components, route handlers | `API_MODE=mock` → answers from `src/mocks`. `live` (default) → calls `GATEWAY_INTERNAL_URL` with the headers below. Calls `connection()`, so the page renders per request. Guarded by `server-only`. |
| `browser.ts` | Client Components | relative `/v1/...` — same origin via the load balancer; sets none of the internal headers |
| `core.ts` | both | `request()`, `fetchTransport()`, `ApiRequestError` (the API error shape), `GatewayError` (anything that isn't the contract: non-JSON, wrong shape, a failure without the error shape). Neither is logged here — `onRequestError` logs once per request. |
| `gateway-headers.server.ts` | `server.ts` only | builds the SSR → gateway headers |
| `id-token.server.ts` | `server.ts` only | ID token from the metadata server, cached until 5 min before `exp` |

## SSR → gateway headers (ADR 0007)

| Header | Value |
| --- | --- |
| `X-Albus-Internal-Auth` | `Bearer <ID token>` for web's runtime SA, audience = `GATEWAY_INTERNAL_URL`. Skipped when `GATEWAY_INTERNAL_AUTH=none`. |
| `X-Albus-Original-Host` | the incoming `Host` — apex or tenant subdomain |
| `X-Albus-Client-IP` | `clientIpFromXff(xff, TRUSTED_PROXY_HOPS)`: skip that many entries from the right (default 1, the LB) and take the next. Proxies append, so the left end is client-controlled. Too few entries → no header at all. |
| `Cookie` | only `__Host-albus_session` and `__Host-albus_anon` (`FORWARDED_COOKIES` in `@albusforge/schema`); the full incoming Cookie header is never forwarded |

There is deliberately no `index.ts`: a barrel would drag `server.ts` into client bundles.

## Server Functions: cookies and credentials

`sessionClient()` (in `server.ts`) is for Server Functions only. It wraps the same transport, and for mutations it reads the response's `Set-Cookie` lines (`requestWithCookies` in `core.ts`) and relays **only** `__Host-albus_session` and `__Host-albus_anon` through `cookies().set` / `.delete` (`cookies.ts`):

- host-only: no `Domain`, `Path=/`, `Secure` — the `__Host-` prefix requires all three — and `HttpOnly`, `SameSite`, `Max-Age` / `Expires` as gateway sent them;
- `Max-Age<=0`, a past `Expires`, or an empty value deletes the cookie;
- any other cookie is ignored.

A newly issued credential also replaces the one in the Cookie header the client sends on its own follow-up reads, so `startBuild`'s transcript read carries the anonymous owner cookie it was just given. Credentials never appear in an action's return value or in a log line. The logic lives in `session-client.ts` (no Next imports) and is tested against a local HTTP gateway stub.

Credentials: server calls forward only `__Host-albus_session` and `__Host-albus_anon`, read from the current `cookies()` store (`credential-cookies.ts`), so a render inside a Server Action — the header after verify — carries the cookie the action just set. The request's Cookie header is the fallback where the store can't be read.
