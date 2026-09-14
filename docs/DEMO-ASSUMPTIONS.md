# Demo assumptions

What is real and what is staged in the end-to-end demo, so the team, and the
judges if asked, can be told exactly. Every mock or best guess is listed with
where it lives and what replaces it. Add a section per area; keep entries
current when one is replaced.

## Portal

Everything here is in `apps/web`. Each entry falls away on its own when
gateway answers the route, because every fallback triggers on gateway's 501
(`isNotImplemented`, `src/lib/api/core.ts`) or on data that doesn't exist yet;
nothing is keyed on an environment flag. One deliberate exception: the home
carousel also shows the labelled example builds when the showcase route fails
outright, because the front door must never be blank for the demo; that
failure is still logged as ERROR so it isn't hidden.

| What the viewer sees | Real or staged | Where | Replaced by |
| --- | --- | --- | --- |
| Landing carousel "Example builds — real designs, sample readings" | Designs and parts are real (registry-pinned); readings, ages and captions are sample | `src/lib/example-builds.ts`, `src/lib/showcase.ts` | `GET /v1/showcase`. Also shown, labelled, if the showcase route fails for any other reason; the outage is still logged as ERROR |
| Marketplace listings, authors, clone counts | Designs real; authors and clone counts sample | `src/lib/example-builds.ts`, `src/app/marketplace/page.tsx` | `GET /v1/listings` |
| Listing page parts, prices, wiring, sample readings | Parts and prices from the registry; wiring drawn from connector tables, not bench-tested; readings sample | `src/components/marketplace/ExampleBuildDetails.tsx` | `GET /v1/listings/:id` |
| "Clone build →" on a listing | Staged: opens the home page with the design as the ask (`/?ask=…`) so the viewer starts a real build from it. Cards say "Open build →" | `src/lib/clone-ask.ts`, `src/app/marketplace/[listingId]/page.tsx`, `src/app/page.tsx` | `POST /v1/listings/:id/remix` |
| Device-ready card "View a sample enclosure in 3D →" | Staged: the checked-in fixture GLB, labelled "Sample enclosure · not this build's". Shown while `GET /v1/builds/:id/body` answers 501 or 404, which the card asks once it is due; a body replaces it on its own | `src/components/enclosure/fixture.ts` (`ENCLOSURE_SAMPLE`), `src/actions/enclosure.ts`, `src/components/build/useEnclosureBody.ts` | Gateway answering the body route (ASK-TO-ENCLOSURE §6); the response shape the portal reads is `src/lib/enclosure-body.ts`, to move into the schema package then |
| `/pricing` lines marked "planned" | Staged: firmware for exact parts, enclosure files, assembly, camera observations, device rules aren't available in the preview; the card marks each | `src/app/(static)/pricing/page.tsx` | Removing the mark as each ships |
| `/pricing` kits and cloud plans | Best guess: introductory prices, labelled as planned and not billed | `src/app/(static)/pricing/page.tsx` | Real pricing and checkout |
| Device page before its first packet: "Waiting for the first reading" with a sample readings table | Real device, real status; the table is the fridge-monitor example build's sample readings, labelled "not from this device" | `src/components/telemetry/AwaitingReadings.tsx` | The device's own readings, once it uploads |
| Camera pictures "isn't switched on for this workspace yet" | Real: gateway 501s until `OBSERVATION_READS_ENABLED=1`; the page says so instead of showing an error | `src/components/telemetry/ObservationGallery.tsx` | Enabling observation reads in the environment |
| Build chat "Reconnecting to build updates…" / "Live updates are unavailable" | Real stream state; "Check for a reply" refetches, never resends. Typing dots give way to it after 30 s (was 60 s) | `src/components/build/BuildConversation.tsx`, `useReplyWatchdog.ts` | Nothing; this stays |
| Error and not-found pages on `/build/[buildId]`, `/live`, `/marketplace/[listingId]` | Real | `error.tsx` / `not-found.tsx` in those segments | Nothing; this stays |

Not staged in the portal, and still a dead end if the backend has nothing:

- Build plans: "Generate plans" stays disabled until a reviewed catalogue exists (`src/components/build/BuildPlanPanel.tsx`). Opens with the assembly and provisioning profiles work.
- Firmware page: "This plan has no available compiler" until a plan is accepted and fwbuild is deployed (`src/app/(app)/projects/[buildId]/firmware/page.tsx`).
- Sensor chat on the device page answers "I can't reach the service right now" if `SENSOR_ASK_URL` is unset in the environment.
- The tenant live stream (`GET /v1/tenants/:id/stream`), device dashboard and closed-loop actions are 501 in gateway. No page renders the components that call them (`LiveFleet`, `LiveDashboard`, `ClosedLoopActions`), so nothing shows them.
