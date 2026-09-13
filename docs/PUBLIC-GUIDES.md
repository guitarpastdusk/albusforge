# Public guides

`/docs` and `/security` are public Next.js server-rendered pages. They reuse PageContainer, PageTitle, Card and the portal design tokens. In-page links use stable heading IDs, a labelled navigation landmark, visible keyboard focus and a single-column layout on small screens. No client state, data fetching, account access or external application dependency is added.

## Delivered

- Quickstart: describe a device, refine the specification, and use the existing account flow in the same browser to claim anonymous work.
- Build guidance: distinguish candidate parts from a validated plan; explain the existing reply/detail recovery controls.
- Flash preparation: explicitly states guided flashing is unavailable; offers a link to the repository's development simulator, without presenting simulated readings as hardware validation.
- Telemetry: distinguish sample and arrival time, missing and zero values, retention and query limits, pending rollups, tenant access and demo data.
- Security: describe implemented session cookie/hash, family revocation, tenant-scoped telemetry reads, separate device credentials and transaction/deduplication controls. Clearly separate implementation from production verification and policy commitments.

## Source map

| Public guidance | Repository evidence |
| --- | --- |
| Conversation and recovery controls | `apps/web/src/components/build/README.md` and conversation components |
| Email sign-in and anonymous claim | `apps/gateway/src/auth-routes.ts`, `auth-store.ts`, `session-cookie.ts` |
| Local simulator and credential handling | `docs/TELEMETRY-INGEST.md` and `apps/cloudlink/src` |
| Device/tenant history and query bounds | `docs/TELEMETRY-READ-API.md`, `apps/gateway/src/telemetry-read.ts`, shared telemetry-read schemas |
| Retention and pending rollups | `docs/TELEMETRY-STORAGE.md`, `packages/db/src/telemetry-storage.ts` |
| Firmware/OTA limitations | `docs/ARCHITECTURE.md` §7 and milestone plan |

Repository-reference links intentionally point to `main`; these pages should be maintained with changes to the supported behavior. They do not introduce pricing, legal terms, a support address, a patch-duration pledge or a compliance claim.

## Validation and remaining work

Rendered-DOM tests check unique heading targets, navigation labels, working internal route destinations and source-file links, plus the distinction between supported flows and incomplete flashing/production/policy work. Run `pnpm --filter web test`, `typecheck`, `lint` and `build` for changes.

Remaining: publish approved pricing and legal copy, define vulnerability reporting and patch policy, verify production onboarding, finish guided flashing/firmware artifacts, and update the guide when real dashboard integration ships. This change does not deploy or verify any hardware or production infrastructure. The existing About page's approved aspirational copy is unchanged; its Security link now lands on concrete implementation and policy status.
