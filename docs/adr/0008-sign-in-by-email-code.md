# 0008 — Sign in with a 6-digit email code, implemented in gateway

**Status:** Proposed, 2026-09-13

## Context

ARCHITECTURE.md §6 and §12.1 specify Lucia session cookies with a magic link. Two things have changed since:

- **The portal design uses a 6-digit code**, not a link: enter an email, receive a code valid for 10 minutes, type it in. There is no password. It is the only sign-up step, shown once the chat has produced a device design.
- **Lucia is deprecated.** Since 2025 it has been maintained as a guide to implementing sessions rather than as a library.

A code also works in cases a link does not: the email opened on a phone while the build is on a laptop, and corporate mail scanners that pre-fetch links and burn single-use tokens.

## Decision

- **Email one-time code.** Six digits, valid for 10 minutes, single use, at most 5 wrong attempts per code before it is invalidated. Stored as a hash. A new request invalidates the previous code.
- **Rate limits** on `POST /v1/auth/code` per email and per IP, in gateway, in addition to Cloud Armor. On a verified internal SSR request the IP is `X-Albus-Client-IP` ([0007](0007-portal-routing.md)); otherwise every SSR call would count as web's IP.
- **Sessions** are opaque random tokens, stored hashed in Postgres with an expiry, sent as an `httpOnly`, `Secure`, `SameSite=Lax`, **host-only** cookie named `__Host-albus_session` ([0007](0007-portal-routing.md)). The `__Host-` prefix makes browsers reject the cookie unless it is `Secure`, `Path=/` and has no `Domain`, so the host-only rule is enforced rather than just followed. The anonymous owner cookie follows the same rules as `__Host-albus_anon` (PORTAL.md §5). Each session carries `active_tenant_id`, and `parent_session_id` when it was created by the subdomain sign-in handoff. Sign-out revokes the whole session family ([0009](0009-tenant-created-at-sign-up.md)).
- **Implemented in gateway** as a small auth plugin following the Lucia session guide, with `@oslojs` primitives for token generation and hashing. The tables (`users`, `sessions`, `email_codes`) live in `packages/db` like every other table.
- A successful verify **claims anonymous builds** owned by the caller's anonymous owner cookie (PORTAL.md §5).
- Routes: `POST /v1/auth/code`, `POST /v1/auth/verify`, `POST /v1/auth/signout`, `GET /v1/me`, `PUT /v1/me/active-tenant` ([0009](0009-tenant-created-at-sign-up.md)).

## Alternatives considered

- **Keep the magic link.** Contradicts the design, and has the cross-device and link-scanner failures above.
- **Better Auth** with its email-OTP plugin. Mature and quick to adopt, but it owns its own tables and migrations, which conflicts with ARCHITECTURE.md §3's rule that `packages/db` owns every migration. The in-house version is a few hundred lines with no framework in the security path.
- **A hosted identity provider.** Adds a vendor and a redirect to the one step the design keeps deliberately short.

## Consequences

- ARCHITECTURE.md §6 and §12.1 change from "Lucia + magic link" to this.
- Email delivery is now on the sign-up critical path: `EMAIL_ADAPTER` needs a transactional provider with fast delivery in staging, not only a log adapter.
- Sign-up and sign-in are the same flow; `/signup` and `/signin` differ in copy only.
- Passkeys remain a later addition on the same session model.
