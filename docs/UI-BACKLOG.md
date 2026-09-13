# UI backlog — audited main, 2026-09-13

Source baseline: `2939b22bc09b35649095e4625dba5fdeb794100b` (`origin/main` when this audit started). This is a source/contract audit, not a claim that these flows were exercised on the deployed site. The inventory below records that baseline; the first-wave status section tracks subsequent implementation PRs. Implementation is not deployment.

There are **44 scoped work items: 42 delivery/verification items and 2 optional product decisions**. These are backlog units, not necessarily one PR each. P0 means the next useful end-to-end demo; P1 completes the intended product journeys; P2 is later operational/product work. “Built” means the UI implementation exists, not that its backend or production configuration is live.

## Delivered and remaining boundaries

The inventory preserves its original audit baseline. The delivery ledger below supersedes baseline labels such as “stub” or “backend missing”; a merged implementation is not deployed acceptance.

- Build conversation, email-code session issuance and anonymous claim are merged. Project detail now renders the stored spec and continuation actions; ready-card session resolution streams without delaying public chat.
- Standalone ingestion, PostgreSQL storage/rollups/retention and authenticated reads are merged. The portal now renders stored fleet/latest/history with bounded UTC controls and inspectable plots.
- Usage exposes recorded tenant model/token/cache/cost and accepted sensor readings/payload bytes. Plan entitlements, physical storage and a durable billing ledger remain separate.
- Sensor Ask backend and gateway/portal integration are merged in PRs #54/#53. Questions are scoped to a device/channel/window with query evidence; transcript persistence, cross-sensor reasoning, anomalies and control actions remain later work.
- Marketplace examples and enclosure viewing components exist. Real publishing/remixing and generated build artifacts remain contract-dependent.

## First-wave delivery ledger

| Items | Deliverable | PR | Acceptance status |
| --- | --- | --- | --- |
| P1, implemented portion of P3 | Public build/telemetry guides and verified security controls | [#48](https://github.com/guitarpastdusk/albusforge/pull/48) | Merged `d734802`; clean merge review and all seven CI checks passed. Approved support/patch commitments remain open. |
| A2, B1, B2 | Session-aware ready action, project overview/empty state, shared Spec display | [#49](https://github.com/guitarpastdusk/albusforge/pull/49) | Merged `00465c6`; reviewed merge head and all seven CI checks passed. |
| T1–T4 core | Stored fleet/latest/history monitor and bounded, inspectable plots | [#50](https://github.com/guitarpastdusk/albusforge/pull/50) | Merged `188620c`; future/open bucket, filter-state and SVG hydration findings closed. Provisioning-derived presentation remains open. |
| T7, account access portion of A3 | Recorded-consumption API and Usage dashboard | [#55](https://github.com/guitarpastdusk/albusforge/pull/55) | Merged `1bb2a7b`; reviewed merge head and all seven CI checks passed. Tenant switching/billing are not implemented by this PR. |
| I1 initial device-question slice | Evidence-backed sensor Ask | [#53](https://github.com/guitarpastdusk/albusforge/pull/53), [#54](https://github.com/guitarpastdusk/albusforge/pull/54) | Merged; see `SENSOR-PORTAL-INTEGRATION.md` for interaction and deployment boundaries. |
| Q1–Q3 first-wave subset | Local combined browser/layout and regression checks | Included above | Production Next with HTTP schema fixtures passed 18 route/viewport captures. This does not verify deployed email/auth/hardware. |

The gateway stream authorization/lease fix (#57) and deterministic intake test schedules (#58), uncovered by first-wave CI, are merged. A non-blocking redundant rollback in the stream helper and transport-error handling in the separate telemetry/Usage session helper remain follow-ups; UI review does not clear those concerns.

## Second wave — parallel UI completion

| Workstream | Backlog coverage | Dedicated branch | Scope |
| --- | --- | --- | --- |
| Sign-in recovery | A5 | `web/auth-recovery` | Actual rate-limit retry feedback, resend pacing, code/email recovery and accurate account-created copy; retain destination and cookie behavior. |
| Page states and accessibility | Q2/Q3 subset | `web/page-states` | Useful loaders, opaque resource-not-found and retry states for project/Usage/telemetry pages; keyboard, focus and narrow-screen checks. |
| Repeatable browser journeys | A1/Q1 subset | `test/ui-browser-journeys` | Committed local Next/gateway/PostgreSQL journeys with a test email sink and deterministic providers. Real deployed delivery remains a separate acceptance gate. |

Each workstream has its own worktree, implementation/scope document, architecture update, PR and exact-head review. Browser tooling owns dependency/CI changes; the other workstreams avoid those files. The existing deployed sensor acceptance, capacity rollout and observability workstreams are complementary, not replaced by local UI tests.

## Following UI batches and dependencies

1. **Account and device setup:** A3/A4, B8, T6/T8 — tenant switching/verified host handoff, claim/provisioning, diagnostics and device metadata APIs are prerequisites for successful saves and setup claims.
2. **Streaming and intelligence:** T5, remaining I1, I2–I4 — durable telemetry events, conversation persistence, cross-sensor query composition, anomaly storage and confirmed action/acknowledgement contracts.
3. **Build outputs:** B3–B7 — accepted plans/BOMs, versioned revisions, wiring, firmware compilation/downloads and generated enclosure artifacts.
4. **Commerce and marketplace:** C1–C4, M1–M5 — approved prices and order/payment/publishing/remix/moderation contracts.
5. **Public policy and release polish:** P2/P4 and remaining P3/Q1–Q4 — approved pricing/legal/support content, real environment acceptance and measured accessibility/performance work. O1/O2 remain optional decisions.

These dependencies prevent honest end-to-end completion; they do not justify inventing successful actions, artifacts, prices or legal commitments in the UI. Partial acceptance of A1/A3/I1/P3/Q items must remain explicit.

## Original baseline inventory

### Account

| ID | Priority | Work | Baseline state | Done when / next deliverable | Dependency / can start | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | P0 | Verify the complete real sign-in journey | Built; integration verification | Exercise email → code → cookie → /projects, anonymous-build claim, reload and sign-out in the browser. Confirm claimed chat and usage stay owned by the correct tenant. | Auth backend is merged; requires configured email delivery and deployed web/gateway. | [Source](<../apps/gateway/src/auth-routes.ts>) |
| A2 | P0 | Make the design-ready CTA session-aware | Partial | Signed-in users continue to their project; anonymous users sign up and return to this build. Do not send every visitor to the same generic signup destination. | Can implement now using existing session/build data. | [Source](<../apps/web/src/components/build/DesignReadyCard.tsx>) |
| A3 | P1 | Account menu and tenant switcher | Missing | Expose Usage, active workspace and role; switch tenants, clear tenant-specific client state and refresh protected data. | Me includes memberships; PUT /v1/me/active-tenant is still unimplemented. | [Source](<../apps/web/src/components/shell/SessionHeader.tsx>) |
| A4 | P1 | Tenant-subdomain sign-in and verified SSR context | Incomplete integration | Apex → tenant-host handoff and return navigation; consistent tenant for SSR and browser reads; unknown/nonmember hosts receive a clear refusal. | Needs handoff endpoints and a consistent verified original-host contract across auth/build/telemetry reads. | [Source](<adr/0009-tenant-created-at-sign-up.md>) |
| A5 | P1 | Email-code recovery and rate-limit UX | Partial | Change email without losing the intended destination; resend cooldown, meaningful 429 retry timing, expired-code and delivery-failure recovery. Preserve existing paste/autofill. | Forms and generic error handling exist; recover structured retry timing from gateway responses. | [Source](<../apps/web/src/components/auth/EmailCodeCard.tsx>) |

### Build

| ID | Priority | Work | Baseline state | Done when / next deliverable | Dependency / can start | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | P0 | Replace the project-detail stub | Stub | Create a useful project overview with current state, spec, transcript/resume action, available artifacts and stage-appropriate next action. Add a first-project empty state to the grid. | Can start with existing BuildDetail and chat. Later panels depend on plan/order/artifact APIs. | [Source](<../apps/web/src/app/(app)/projects/[buildId]/page.tsx>) |
| B2 | P0 | Align SpecPanel with the merged shared Spec contract | Partial | Use the now-merged Spec definitions for capabilities, assumptions and open questions; retain safe handling of incomplete drafts. Verify fresh spec versions after streamed replies. | Can start now; the local draft parser still says the shared schema has not landed. | [Source](<../apps/web/src/components/build/SpecPanel.tsx>) |
| B3 | P1 | Parts review and real plan handoff | Missing beyond part chips | Show the solved BOM, quantities, exact part versions, cost basis, compatibility/evidence and plan status. Keep candidate matches distinct from an accepted feasible plan. | Matcher implementation exists; persisted plan/orchestration and gateway plan contract still needed. | [Source](<../apps/web/src/components/build/CandidateParts.tsx>) |
| B4 | P1 | Spec revisions, alternatives and infeasibility decisions | Missing | Let users compare a proposed revision, understand minimal conflicts and choose a trade-off; clearly invalidate or replace artifacts derived from an older spec. | Requires edit/replan APIs and versioned solver explanations; design can start. | [Source](<ARCHITECTURE.md>) |
| B5 | P1 | Schematic and assembly instructions | Missing | Render the actual wiring/pin map and step-by-step assembly with part-specific power and connector details. | Requires plan/wiring artifacts; current public schematic illustrations are not a generated assembly guide. | [Source](<ARCHITECTURE.md>) |
| B6 | P1 | Firmware/artifact workspace and pipeline progress | Missing beyond build status | Show generation/compile results, file summary, versioned firmware downloads and retryable stage failures. Add instruction-driven edits with diff and compile-gated acceptance. | M4 code/artifact/edit APIs required; OTA rollout/rollback is later M8 scope. | [Source](<ARCHITECTURE.md>) |
| B7 | P1 | Connect the existing enclosure viewer to generated bodies | Fixture/placeholder integration | Load real build-specific GLB and fallback image, lint/fit results and STEP/STL downloads with generation/version/error states. Preserve base/lid/exploded, parts visibility and accessibility already built. | Viewer exists; body generation/storage/presigned artifact contract required. | [Source](<../apps/web/src/components/enclosure/fixture.ts>) |
| B8 | P1 | Guided flash, device claim and first reading | Missing | Guide supported flashing/provisioning, claim the device to the build, show self-test/connectivity and confirm the first authenticated sample. Provide retry/help states. | Requires production provisioning/claim and firmware/hardware path. Can design against contracts now. | [Source](<ARCHITECTURE.md>) |

### Telemetry

| ID | Priority | Work | Baseline state | Done when / next deliverable | Dependency / can start | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | P0 | Connect fleet to stored telemetry | Built UI, API mismatch | Use merged /v1/telemetry/devices or a deliberate backend adapter; display real status/last seen, pagination and no-device state. Do not fabricate build groups or names absent from storage. | Read API is ready; current /live still calls unimplemented /v1/tenants/:id/devices. | [Source](<../apps/web/src/app/(app)/live/page.tsx>) |
| T2 | P0 | Connect device detail/latest and derive dashboard metadata | Built UI, API mismatch | Render real channels, units, latest values and health; derive names/precision/widgets from actual provisioning data, or explicitly support a minimal telemetry view until that metadata exists. | Read API is ready; existing DeviceDashboard contract needs build/name/widget fields not supplied by it. | [Source](<../apps/web/src/app/(app)/live/[deviceId]/page.tsx>) |
| T3 | P0 | Make charts time-correct and inspectable | Partial | Position points by timestamps, expose axes/units and hover/focus values, distinguish raw samples from averages, and show gaps without implying continuous measurements. | Can start independently. Current chart receives only values and spaces them evenly. | [Source](<../apps/web/src/lib/chart.ts>) |
| T4 | P0 | History controls, retention and rollup freshness | Missing controls/integration | Add time-window/channel/resolution selection, aligned bucket requests, loading/cancellation, pending-rollup notice and actionable 410/422/503 handling. Never present truncated/expired history as complete. | Merged read API supports raw ≤24h, minute ≤7d, hourly ≤366d request windows and ≤2000 points. | [Source](<TELEMETRY-READ-API.md>) |
| T5 | P1 | Connect real telemetry streaming and replay/backfill | Client built; backend missing | Reuse existing SSE client/reducers for tenant/device updates, reconnect and history refresh. Cover missed events, session changes and connection states with real data. | Tenant SSE/event publication is absent from gateway; existing dev stream/proxy and mocks do not make production events live. | [Source](<../apps/web/src/lib/live/useLiveStream.ts>) |
| T6 | P1 | Device diagnostics and health history | Partial current-state widgets | Distinguish last packet arrival from last sample, show never-seen/offline/revoked status, channel faults, battery/signal and self-test history with recovery guidance. | Current latest health available; historical diagnostics/self-test event storage/API still needed. | [Source](<../apps/web/src/components/devices/DeviceStatusHeader.tsx>) |
| T7 | P0 | Finish Usage and make it reachable | Stub; backend missing | Show intake model calls/tokens/cost and telemetry usage for a clear period, with zero states and plan limits when supported. Add account navigation. | GET /v1/usage absent; current Usage schema only has tier2/tier3 and must account for actual intake usage rather than mislabel it. | [Source](<../apps/web/src/app/(app)/usage/page.tsx>) |
| T8 | P1 | Fleet organization and device presentation settings | Missing | Add search/filter, site/tag grouping and editable names/channel/widget overrides where supported; retain correct counts across pagination. | Requires actual build/device metadata and settings APIs; no invented tenant totals from a single page. | [Source](<CLOUD-PLATFORM.md>) |

### Intelligence

| ID | Priority | Work | Baseline state | Done when / next deliverable | Dependency / can start | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| I1 | P1 | Connect device Ask to evidence-backed answers | Chat UI built; backend missing | Render real answers with executed-query evidence and chart/range links; separate an answer from a proposed action and recover from tool/model failure. | Device Ask endpoint and typed tenant-bound intelligence tools required. | [Source](<../apps/web/src/components/devices/DeviceChat.tsx>) |
| I2 | P1 | Build Signals exploration | Missing | Create cross-device/channel charts with time/range selection, units and comparison overlays; make anomalies and Ask answers deep-link to the same evidence view. | Needs query composition contract; existing per-channel telemetry history is a foundation. | [Source](<CLOUD-PLATFORM.md>) |
| I3 | P1 | Build anomaly/alert Inbox | Missing | List/filter anomalies, inspect evidence and baselines, acknowledge/label outcomes and show read-only permissions and empty states. | Requires deterministic detectors, anomaly storage and acknowledgement APIs. | [Source](<CLOUD-PLATFORM.md>) |
| I4 | P1 | Complete confirmed-rule lifecycle and tenant-wide alert management | Per-device controls built; backend missing | Connect propose → review → confirm, optimistic rollback, pending version → device acknowledgement and actual execution outcome; add tenant-wide rules and notification destinations. | Rule/proposal APIs, permissions, audit, device acknowledgement and alert delivery required; preserve existing confirmation semantics. | [Source](<../apps/web/src/components/devices/ClosedLoopActions.tsx>) |

### Fulfillment

| ID | Priority | Work | Baseline state | Done when / next deliverable | Dependency / can start | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | P1 | Checkout and fulfillment selection | Missing | Review kit/cart, choose home-print versus full-ship, collect address where needed and present validated price/payment confirmation and failure recovery. | Requires order/checkout/payment contract and approved fulfillment/pricing rules. | [Source](<ARCHITECTURE.md>) |
| C2 | P1 | Order/kit tracking | Project destination is a stub | Show order status, assembly/print/shipping milestones, tracking link and next setup step; handle delayed/failed fulfillment clearly. | Order and fulfillment status APIs required. | [Source](<../apps/web/src/app/(app)/projects/[buildId]/page.tsx>) |
| C3 | P2 | Subscription, caps and billing self-service | Missing; product/API decisions | Present the actual plan, included usage/caps and billing history or payment-management link when billing exists. Do not display invented entitlements. | Billing/plan backend and commercial decisions required; Usage visibility is P0 separately. | [Source](<CLOUD-PLATFORM.md>) |
| C4 | P2 | Post-delivery support and warranty path | Missing | Link diagnostics to a clear help/contact and returns path, and show the applicable patch/support term for the device. | Support/RMA workflow and approved warranty/security commitments required. | [Source](<ARCHITECTURE.md>) |

### Marketplace

| ID | Priority | Work | Baseline state | Done when / next deliverable | Dependency / can start | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | P1 | Finish real listing detail | Examples have detail; real listing branch is a stub | Show published snapshot, BOM/media/story, buildability and author attribution with clear example-versus-real status. | Real listing/snapshot API required; ExampleBuildDetails is reusable display evidence, not a published listing. | [Source](<../apps/web/src/app/marketplace/[listingId]/page.tsx>) |
| M2 | P1 | Connect catalogue and curated showcase | Grid/carousel built; example fallback | Use real listing/search/filter/pagination and curated opt-in showcase responses, retaining honest empty/unavailable and example labels. | Listing/showcase endpoints absent. Existing examples remain intentional until they exist. | [Source](<../apps/web/src/lib/example-builds.ts>) |
| M3 | P1 | Clone/remix with a reviewable diff | Missing | Require sign-in, clone only the public snapshot, explain unavailable/retired part substitutions and open the resulting build. | Remix endpoint, pinned-version resolution and diff contract required. | [Source](<PORTAL.md>) |
| M4 | P1 | Publish workflow and media upload | Missing | Preview/edit a public story, select tags/media and explicitly confirm publication. Show the immutable snapshot and exclude private chat/device data. | Publish, media-upload and policy/moderation contracts required. | [Source](<ARCHITECTURE.md>) |
| M5 | P2 | Verified-build reviews and remix lineage | Missing | Show lineage and allow reviews only for backend-verified builders; handle report/moderation states when the product contract exists. | Reviews/verified-built/lineage APIs and moderation workflow required. | [Source](<ARCHITECTURE.md>) |

### Public pages

| ID | Priority | Work | Baseline state | Done when / next deliverable | Dependency / can start | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | P0 | Replace Docs placeholder | Placeholder | Ship a usable quickstart and supported-parts/build/flash/telemetry guides with navigation and accurate links to currently available features. | Can start now from repository docs; no new backend. | [Source](<../apps/web/src/app/(static)/docs/page.tsx>) |
| P2 | P1 | Replace Pricing placeholder | Placeholder | Explain actual kits/cloud offerings, included usage and what is not yet sold, with accurate next actions. | Needs approved pricing/entitlements; layout can start now. | [Source](<../apps/web/src/app/(static)/pricing/page.tsx>) |
| P3 | P1 | Publish the Security pledge page | Placeholder | Describe the implemented security/data controls and actual patch/support commitment, with appropriate contact links and explicit limitations. | Approved product/security copy; avoid claims beyond delivered behavior. | [Source](<../apps/web/src/app/(static)/security/page.tsx>) |
| P4 | P1 | Fix Terms/Privacy destinations and signup copy | Missing dedicated destinations | Provide the intended terms/privacy pages and point signup to them; the current terms link targets the placeholder Security page. | Approved policy copy and product decisions; no inferred legal conclusions in this backlog. | [Source](<../apps/web/src/components/auth/EmailCodeCard.tsx>) |

### Quality

| ID | Priority | Work | Baseline state | Done when / next deliverable | Dependency / can start | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 | P0 | Automate real browser acceptance journeys | Component/unit coverage exists; no committed E2E harness found | Cover anonymous chat → sign-in/claim → project resume, tenant isolation in navigation, real history and error/retry flows. Add browser network assertions for mocks/credentials. | Requires isolated test services/fixtures; no production writes needed. | [Source](<../apps/web/package.json>) |
| Q2 | P0 | Responsive and accessibility completion audit | Partially implemented; needs systematic verification | Verify narrow-screen projects/usage/charts, keyboard/focus, screen-reader labels/live regions, touch targets, reduced motion and contrast; repair concrete failures. | Existing mobile nav, code autofill and enclosure focus handling should be retained, not rebuilt. | [Source](<../apps/web/src/components/shell/Header.tsx>) |
| Q3 | P0 | Complete page-specific loading/empty/error/not-found states | Global failures and some live states exist | Add useful first-use projects, unknown device/project/listing, unavailable integration, denied access and recovery states; retain content when a single widget fails. | Route-specific loading/not-found files are absent; status handling should distinguish 401/403/404/410/422/429/503. | [Source](<../apps/web/src/app/error.tsx>) |
| Q4 | P1 | Validate real browser performance and release presentation | Partial protections exist; no full audit claimed | Measure streaming chat, chart re-renders and 3D load/disposal on representative mobile browsers; check public metadata/share previews and prevent authenticated data caching. | Existing lazy 3D/bundle isolation tests are a foundation; establish budgets from measured results. | [Source](<../apps/web/src/components/enclosure/README.md>) |

### Later decisions

| ID | Priority | Work | Baseline state | Done when / next deliverable | Dependency / can start | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| O1 | Optional | Public analytics and consent UI | Design document only | If requested, implement the approved public-only analytics/consent design, excluding private routes and tenant hosts and supporting revocation. | Explicit product/provider decision; not a requirement for ingestion or the next sensor demo. | [Source](<UI-ANALYTICS.md>) |
| O2 | Optional | Dark mode | Not designed | Design and verify semantic color, chart, status and 3D fallback treatments before adding a theme switch. | Current design is light-only; not a blocker for the core journey. | [Source](<PORTAL.md>) |

## Contract and release guardrails

- Use current main/code as implementation evidence. PORTAL.md and ARCHITECTURE.md mix target design with historical status; update those status notes when the corresponding UI change lands.
- A passing mock/component test is not evidence that a production endpoint is implemented. Keep examples and incomplete capabilities labelled; never show a successful save/actuation for a 501 or failed write.
- The new telemetry read schema intentionally differs from the provisioned dashboard schema. Resolve this explicitly in T1/T2 rather than coercing one into the other with fake metadata.
- Time-series UI must respect actual timestamps, missing data, exact sequence identity, rollup freshness, retention and API response limits. A line through equally spaced array positions is not an adequate historical time axis.
- Existing SSR header signing does not by itself prove every gateway route honors the same tenant-host contract. A4 must verify the complete read and authentication path.
- Prices, legal/policy commitments, analytics provider selection and dark mode are decisions or approved-copy dependencies; this audit does not invent those answers.

## Suggested first PR batches

| Batch | Items | Reviewable result |
| --- | --- | --- |
| UI-1 | T1 + minimal T2 + T3/T4 core | A signed-in person sees real devices, latest readings and truthful bounded history. |
| UI-2 | B1 + B2 + A2 | Project detail is useful, resumes its real conversation and preserves signup/build context. |
| UI-3 | T7 + account Usage link | A real usage endpoint and understandable page expose intake and sensor usage. |
| UI-4 | P1 + approved portions of P2–P4 | Public footer links lead to substantive, accurate pages. |
| UI-5 | A1 + Q1–Q3 regressions for those batches | Browser evidence of the complete paths and usable failure/mobile states. |

The original audit opened no implementation PR. The delivery ledger above now tracks the submitted and merged batches; each further batch requires its own exact-head review and CI validation.
