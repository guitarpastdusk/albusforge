# src/lib/api/

The gateway client. Every response is validated against `@albusforge/schema`; a non-2xx is validated against the error shape and thrown as `ApiRequestError`.

| File | Use from | What it does |
| --- | --- | --- |
| `server.ts` | Server Components, route handlers | `API_MODE=mock` → answers from `src/mocks`. `live` → calls `GATEWAY_INTERNAL_URL` with the headers below. Calls `connection()`, so the page renders per request. Guarded by `server-only`. |
| `browser.ts` | Client Components | relative `/v1/...` — same origin via the load balancer; sets none of the internal headers |
| `core.ts` | both | `request()`, `fetchTransport()`, `ApiRequestError` |
| `gateway-headers.server.ts` | `server.ts` only | builds the SSR → gateway headers |
| `id-token.server.ts` | `server.ts` only | ID token from the metadata server, cached until 5 min before `exp` |

## SSR → gateway headers (ADR 0007)

| Header | Value |
| --- | --- |
| `X-Albus-Internal-Auth` | `Bearer <ID token>` for web's runtime SA, audience = `GATEWAY_INTERNAL_URL`. Skipped when `GATEWAY_INTERNAL_AUTH=none`. |
| `X-Albus-Original-Host` | the incoming `Host` — apex or tenant subdomain |
| `X-Albus-Client-IP` | the LB-observed visitor IP: the **second-to-last** `X-Forwarded-For` entry. The LB appends `<client>, <lb>` to anything the client sent, so the first entry is spoofable. |
| `Cookie` | only `__Host-albus_session` and `__Host-albus_anon` (`FORWARDED_COOKIES` in `@albusforge/schema`); the full incoming Cookie header is never forwarded |

There is deliberately no `index.ts`: a barrel would drag `server.ts` into client bundles.
