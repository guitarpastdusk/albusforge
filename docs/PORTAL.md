# Albus Forge — The Portal

The web app a person actually touches: an anonymous chat that turns a sentence into a device design, email-code sign-up, a projects workspace, a live fleet view, a per-device dashboard with device chat, and a community marketplace.

Source material: the **Albusforge.ai website design handoff** (high-fidelity HTML prototype plus spec, September 2026), [`ARCHITECTURE.md`](ARCHITECTURE.md) §6, [`CLOUD-PLATFORM.md`](CLOUD-PLATFORM.md) §6–7, and [ADR 0007](adr/0007-portal-routing.md) (portal routing, on the infra PR). The prototype's copy and colours are final design intent; its data and flows are mock and are replaced by the routes below.

---

## 1. Where it sits

- **One app, `apps/web`.** Next.js App Router, TypeScript, zod types imported from `packages/schema`. It is a pure client of the gateway. **No Next.js API routes**, so §6's "one gateway" rule holds.
- **Cloud Run service `web`** behind the same load balancer as gateway ([ADR 0007](adr/0007-portal-routing.md)): `/v1` and `/v1/*` → gateway, everything else → web, identically on the apex and on every tenant subdomain.
- **Browser code calls relative `/v1/...`.** Same origin on every host, no CORS.
- **Server-side rendering calls `GATEWAY_INTERNAL_URL`** (gateway's `run.app` URL over the VPC), never the public domain. A server call through the public domain exits through Cloud NAT, and Cloud Armor would then count every visitor as one IP against the 600 req/min limit.
- **SSR forwards the visitor's host and IP through a verified contract** ([ADR 0007](adr/0007-portal-routing.md)). On a `run.app` call the `Host` header is gateway's own hostname, so without this SSR on `acme-plant.albusforge.ai` could not resolve its tenant. Every SSR call to gateway sends:
  - `X-Albus-Internal-Auth: Bearer <ID token>`: a Google-signed ID token for web's runtime service account, with audience `GATEWAY_INTERNAL_URL`
  - `X-Albus-Original-Host`: the host the browser requested
  - `X-Albus-Client-IP`: the visitor's IP
  - the two authentication cookies only, `__Host-albus_session` and `__Host-albus_anon` (§5), never the full `Cookie` header. `/build/:buildId` renders server-side for anonymous visitors, so the anonymous owner cookie has to be forwarded as well as the session cookie.

  Gateway trusts the two forwarded headers **only** when the token verifies: Google signature, `aud` equal to gateway's URL, `email` equal to `SSR_SERVICE_ACCOUNT`, `email_verified`, not expired. Otherwise it ignores them and uses the real `Host` and client IP. A forwarded host that is neither `PUBLIC_DOMAIN` nor `<valid slug>.PUBLIC_DOMAIN` is `400`. The load balancer strips all three headers from public requests as defense in depth; the token check is the actual control. Terraform sets `GATEWAY_INTERNAL_URL` and `PUBLIC_DOMAIN` on web, and `SSR_SERVICE_ACCOUNT` and `PUBLIC_DOMAIN` on gateway.
- **Both authentication cookies are host-only** (`__Host-` prefix, no `Domain` attribute), because `staging.albusforge.ai` sits under the prod apex. Signing in on a tenant subdomain is a redirect handoff from the apex.
- Web and gateway share one per-IP Cloud Armor limit, and every static asset counts toward it. A cold page load is ~15–25 requests, which is comfortable at 600/min, but it is the first thing to check if real users see 429s before assets move behind a CDN backend bucket.

---

## 2. Screens and routes

| Screen | Route | Session | Reads / writes |
| --- | --- | --- | --- |
| Landing: hero, starter chips, live carousel | `/` | none | `GET /v1/showcase` · `POST /v1/builds` |
| Build chat, device-ready card, sign-up gate | `/build/:buildId` | none (anonymous owner cookie) | `GET/POST /v1/builds/:id/messages` · `GET /v1/builds/:id/events` · `GET /v1/builds/:id` |
| Sign up: email → code → done | `/signup` | none | `POST /v1/auth/code` · `POST /v1/auth/verify` |
| Sign in | `/signin` | none | same two routes |
| Projects | `/projects` | required | `GET /v1/builds` |
| Project detail: resume chat, review parts, track kit | `/projects/:buildId` | required | `GET /v1/builds/:id` — **not designed yet** |
| Live systems (fleet) | `/live` | required | `GET /v1/tenants/:id/devices` · `GET /v1/tenants/:id/stream` |
| Device dashboard + device chat | `/live/:deviceId` | required | `GET /v1/devices/:id/dashboard` · `GET /v1/devices/:id/series` · `POST /v1/devices/:id/ask` |
| Usage | `/usage` | required | `GET /v1/usage` — **not designed yet**; minimal in M2 |
| Marketplace | `/marketplace` | none | `GET /v1/listings?tags=` |
| Listing | `/marketplace/:listingId` | none; clone requires session | `GET /v1/listings/:id` · `POST /v1/listings/:id/remix` |
| Docs, Pricing, Security pledge | `/docs` `/pricing` `/security` | none | static |

The UI says **Clone**; the API says **remix**. They are the same action. The marketplace filter pills (Garden, Home, Workshop, Industrial) are `tags`.

---

## 3. API additions

Routes the design needs that §6 does not have. They are added to the §6 contract block; the tenant, fleet and device-series routes are the ones [`CLOUD-PLATFORM.md`](CLOUD-PLATFORM.md) §11 already specifies.

```
POST   /v1/auth/code               { email } → 204           rate-limited per email and per IP
POST   /v1/auth/verify             { email, code } → Me = { user, tenant, tenants } + Set-Cookie; claims anonymous builds
POST   /v1/auth/signout            → 204
GET    /v1/me                      → Me = { user, tenant, tenants } | 401
PUT    /v1/me/active-tenant        { tenant_id } → 204           membership checked; apex only

GET    /v1/builds?status=          the session tenant's builds, with display_status
GET    /v1/builds/:id/messages     chat transcript
POST   /v1/builds/:id/messages     { text } → 202; the reply streams over /v1/builds/:id/events

GET    /v1/showcase                public, curated live cards for the landing carousel

GET    /v1/usage                   current period for the resolved tenant: model calls and tokens per tier;
                                   readings and storage added in M6

POST   /v1/devices/:id/ask         { text } → answer + executed queries; /v1/ask with device_id bound
```

Notes:

- **`/v1/auth/*`** — see [ADR 0008](adr/0008-sign-in-by-email-code.md). Replaces the magic link. `POST /v1/auth/verify` and `GET /v1/me` return the same `Me` shape: `user`, `tenant` (the active tenant, with the caller's `role`) and `tenants` (every tenant the user belongs to, active one included, so the portal can show a switcher without a second call).
- **Chat messages are the intake conversation, stored.** `POST /v1/builds` still takes `{ ask_text }` and becomes the first message. Clarifying questions from intake arrive as assistant messages, and user replies are what `PATCH /v1/builds/:id/spec { answers }` receives today. The transcript needs a `build_messages` table so a refreshed tab and a resumed project read the same record.
- **`build_messages` is private to the build's tenant** (or its anonymous owner) and is never readable through a listing. A marketplace **story is written at publish time**. It can be pre-filled as a draft from the transcript, but the user edits and confirms it, it passes the same `policy.ts` `safety_class` check as the rest of the listing, and it is stored on the listing and the immutable `build_snapshot` (ARCHITECTURE.md §7.7). Chat that continues after publishing never changes it, and remix copies the snapshot, never the transcript.
- **`/v1/showcase`** is curated and opt-in, not a live query across other people's devices. At launch it can be a static list maintained by hand. A real feed needs a per-build `showcase_opt_in` and must never expose location — the prototype shows coordinates on a fleet card, which is fine for an owner and not for the public.
- **`/v1/devices/:id/ask`** is a thin wrapper. The tool loop is [`CLOUD-PLATFORM.md`](CLOUD-PLATFORM.md) §7.4 unchanged, with `tenant_id` from the session and `device_id` from the path, both bound server-side. Answers the design shows ("you'll cross the 22% threshold in ~2 days — want me to alert you at 24%?") map to `compare_to_baseline` plus a proposed alert rule the user confirms — the same proposal pattern as `create_work_order`.

---

## 4. Project status is derived

The Projects screen shows one status pill per build. It is computed by the gateway, never stored:

| `display_status` | Pill | Condition, first match wins | Card action |
| --- | --- | --- | --- |
| `live` | Live · green | at least one device on the build has reported | Open dashboard |
| `kit_shipped` | Kit shipped · blue | an order exists and fulfillment has shipped | Track kit |
| `parts_picked` | Parts picked · violet | a plan exists for the current spec version | Review parts |
| `designing` | Designing · peach | anything earlier | Resume chat |

Device counts on the card use the plan's device count before provisioning and real devices after. The design is explicit that the label pluralises: "1 device", "4 devices".

---

## 5. Anonymous build → account

Chat is anonymous; the only sign-up ask is the gate on the device-ready card.

1. `POST /v1/builds` without a session sets a host-only, httpOnly **anonymous owner cookie**, `__Host-albus_anon`, and records its hash on the build (`builds.anon_owner_hash`, `tenant_id` null). `CHECK (tenant_id IS NOT NULL OR anon_owner_hash IS NOT NULL)` guarantees every build has one owner or the other.
2. **Each cookie is an independent credential.** An unclaimed build (and its messages) is readable with a matching `anon_owner_hash`. A claimed build needs a session whose user is a member of the build's tenant. No route requires both. After sign-in a leftover anonymous cookie is harmless, because verify has already cleared the hash it would match. LLM usage for an unclaimed build is recorded against the same hash.
3. `POST /v1/auth/verify` moves every build carrying the cookie's hash, **and the usage rows those builds incurred**, into the tenant resolved for that request. On a first sign-up that is the new personal tenant. It clears the hash and the cookie in the same transaction and returns the session.
4. Anonymous builds that are never claimed are removed after 30 days by a scheduled job. Their usage stays as platform cost.

Which tenant a request uses, and why the Host header alone never grants access, is [ADR 0009](adr/0009-tenant-created-at-sign-up.md).

This is the concrete version of §6's "anonymous builds are allowed until checkout": checkout, saving and cloning all require a session; designing does not.

---

## 6. Rules the UI code follows

- **The device dashboard renders widget config; it does not hard-code screens.** The prototype shows a moisture line chart and battery, signal, uptime and self-test tiles. That is one output of [`CLOUD-PLATFORM.md`](CLOUD-PLATFORM.md) §6.1's derivation, not a template. `apps/web` keeps a component per widget `type` and renders whatever `GET /v1/devices/:id/dashboard` returns.
- **One SSE client** for build progress, chat replies and telemetry ([`CLOUD-PLATFORM.md`](CLOUD-PLATFORM.md) §6.2). No WebSocket, no polling.
- **Schema first, mocks second.** Every response the portal reads has a zod schema in `packages/schema`. Until a route exists, `apps/web` serves a mock that must parse against that schema (`API_MODE=mock`), and a test enforces it. Connecting a real route is deleting its mock.
- **Registry-backed copy.** Part names, prices and capabilities on the device-ready card come from the plan, never from UI strings.

---

## 7. Where the design and the registry disagree

The prototype's example builds are illustrative. They are fine as mock data and must not become seed data:

| In the design | In the architecture |
| --- | --- |
| ESP32-WROOM on the device-ready card | ESP32-S3 only for MVP (§12.1) |
| nRF52840, LoRa, a LoRa gateway, PT100, load cells, current clamp | not among the twelve MVP parts (§4.1); LoRa is in the transport enum but has no part |
| "free lifetime security patches" in chat copy | the patch pledge has a defined term (§10) — copy should match it |
| "signed log", "monthly PDF export" on the cold-room listing | no route or job produces either |

---

## 8. Not designed yet

Surfaces the architecture requires that the handoff does not cover. They need designs before they can be built:

- **Project detail** — the targets of "Review parts" and "Track kit": the plan and cart, firmware and enclosure downloads, checkout, order tracking.
- **Alert rules** — the device chat offers to set one; there is no screen to see or edit them.
- **Signals, Inbox, Usage** ([`CLOUD-PLATFORM.md`](CLOUD-PLATFORM.md) §6.3). **Usage is not optional:** it ships with the first metered call ([`CLOUD-PLATFORM.md`](CLOUD-PLATFORM.md) §9). Intake's model calls are metered from M2, so a minimal Usage screen is needed by M2 even before a full design exists.
- **Listing detail and publish** — the marketplace grid exists; the listing page, remix diff and publish flow do not.
- **Tenant subdomain sign-in handoff** ([ADR 0007](adr/0007-portal-routing.md)), and sign-out that revokes the sessions on every host together ([ADR 0009](adr/0009-tenant-created-at-sign-up.md)).
- **Tenant switcher** for a user in more than one tenant ([ADR 0009](adr/0009-tenant-created-at-sign-up.md)).
- Error, empty and offline states for every screen; mobile layouts; dark mode (the design is light only).

---

## 9. Sequencing

The portal is built against mocks from M0 and connected screen by screen as the backend lands:

| Milestone | Portal work |
| --- | --- |
| **M0** | workspace root, `apps/web` shell, design tokens, landing page, every route stubbed on mocks; `web` is the M0 service that proves a commit reaches staging |
| **M1** | `tenants`, `build_messages`, `anon_owner_hash` in the schema ([ADR 0009](adr/0009-tenant-created-at-sign-up.md)) |
| **M2** | auth routes; build chat and the device-ready card go live against intake; **minimal Usage screen and `GET /v1/usage`** (model calls and tokens per tier), because intake's calls are the first metered calls |
| **M3** | device-ready card shows the real plan; Review parts |
| **M6** | Live systems, device dashboard, Track kit; Usage extended with readings and storage |
| **M6.5** | device chat; Signals and Inbox |
| **M7** | marketplace, clone, listing pages |

---

## 10. Decisions

| Decision | Outcome | Record |
| --- | --- | --- |
| Sign-in method | 6-digit email code, implemented in gateway, sessions in Postgres | [ADR 0008](adr/0008-sign-in-by-email-code.md) — Accepted |
| Tenant root | tenant created at sign-up, not derived from an order | [ADR 0009](adr/0009-tenant-created-at-sign-up.md) — Accepted |

### Still open

| Decision | Recommendation | Record |
| --- | --- | --- |
| Node version | Node 22 LTS; §12.1's Node 20 reached end of life on 2026-04-30 | this document |
| Showcase at launch | hand-curated static list, no live feed | §3 |
