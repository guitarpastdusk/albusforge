# Project workspace

UI delivery for backlog B1, B2 and A2. This describes implemented web behavior, not a production deployment or completion of the later build pipeline.

## Delivered

- `/projects` reads the authenticated build list. Every card opens `/projects/:buildId`; an empty list invites the person to describe a first device. The grid fits narrow screens.
- `/projects/:buildId` requires a session before fetching `BuildDetail`. The gateway continues to enforce build ownership. The overview shows the server-provided display state, description, update time (UTC), spec version and device count. Its conversation action opens the existing `/build/:buildId` transcript and reply flow; live builds additionally link to the fleet without inventing a build-to-device mapping.
- The overview renders the stored specification and capability matches. A settled specification and candidate parts remain distinct from a ready design summary; only a supplied `ready` card yields a design summary, parts and estimate.
- `SpecPanel` derives its display parser from the shared `Spec` field schemas. Missing or malformed draft sections are omitted while valid sections remain visible. Capabilities, assumptions and open questions appear alongside the sensing, environment, connection, power and experience fields. The existing stream refresh machinery continues to fetch new versions after `build.updated` and reconnects.
- The ready card receives the actual build ID and a boolean server session result from both landing and reopened conversation pages. Signed-in visitors open `/projects/:buildId`; anonymous visitors open `/signup?next=<encoded project path>`. Existing verification claims anonymous builds and follows the validated destination. No identity or session token is passed to client components. Session expiry is still enforced by the protected destination and gateway.
- No fixture enclosure is presented as a generated project artifact. The workspace explicitly says firmware, wiring, generated enclosure files and order tracking are not available yet.

## Boundaries and next work

The overview uses only `GET /v1/builds` and `GET /v1/builds/:id`; conversation reads/messages/SSE retain their existing contracts. It introduces no gateway route, order API, generated asset URL or solver result. Existing error and not-found boundaries remain in effect. Project overview updates on navigation/reload; the conversation is the surface with live spec refresh.

Solved BOM quantities, compatibility evidence, revisions, wiring, firmware and enclosure downloads, order tracking and guided device setup need their respective backend contracts (B3–B8). The deployed email-code, anonymous claim and tenant session journey still needs acceptance verification with real configured services (A1). Server session state is a rendering hint for the CTA, never an authorization decision.

## Validation

Web tests cover empty/listed projects, authorization before protected data reads, exact resume and signup destinations, DOM rendering of both ready-card session states, capability-only/partial specs, shared optional experience fields, candidate versus ready state, and live fleet navigation. Existing build-stream freshness and auth destination tests remain part of the full suite. Typecheck, lint and production build validate integration. DOM tests are not a claim of deployed browser or email delivery acceptance.
