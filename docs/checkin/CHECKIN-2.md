# Albus Forge — Check-in 2

**Battle of the Coasts · Hour 24 · 13 Sep 2026** · Track: **Deep Tech / Physical AI**

**Team:** Albus · **Solo hacker:** Sukrit Dasgupta · **Website:** [albusforge.ai](https://albusforge.ai) · **Code:** [guitarpastdusk/albusforge](https://github.com/guitarpastdusk/albusforge)

> **One question in. A working device out, with a cloud that helps it improve.** Ask “keep my greenhouse soil moist.” Albus Forge aims to turn that intent into a checked parts list, printable enclosure and firmware, then connect the device to a confirmed **sense → detect → reason → act → confirm** loop.

**What changed:** Check-in 1 established the portal and infrastructure. This interval added a real database and parts API, a deterministic assembly solver, printable enclosure generation, durable sensor ingestion, and the portal's confirmed-rule interaction. **21 PRs merged since `CHECKIN1`; 1,056 automated tests pass across CI and the local CAD suite.** These are working components; the complete ask-to-physical-action journey is not yet demonstrated.

**Snapshot:** `CHECKIN1` (`0f7e7c4`) → main `cbfaa17` (13 Sep, 13:13 EDT). Unmerged work is identified separately. [Full statistics and evidence](CHECKIN-2-EVIDENCE.md).

---

## 1. Goals carried forward from Check-in 1

| Hour-24 goal | Result at this snapshot |
| --- | --- |
| Cloud SQL and the database schema | **Delivered:** SQL infrastructure, migrations, restricted application role, and registry/build/telemetry storage are merged. |
| A real gateway serving the registry | **Live:** `/v1/parts` returns 12 draft definitions on staging and production. Anonymous build ownership, durable messages and replayable chat events are merged. |
| First AI step: ask → structured spec | **In progress:** intake/LLM service is in PR #37; streaming portal chat is in PR #36. Neither is counted as merged or an end-to-end AI demo here. |

## 2. Innovation: one parts model, two connected loops

The differentiator is the connection between **building the device** and **operating it**. A versioned part definition supplies electrical constraints to the matcher, mechanical data to enclosure generation, and channel meanings to telemetry. This shared engineering contract keeps every downstream decision traceable to the same part version.

**Build loop.** AI interprets the request; deterministic code checks whether an assembly is feasible. The new solver checks capability coverage, dependencies, conflicts, I²C addresses, runtime/driver compatibility, connectors, available ports and power budgets. It ranks only feasible plans and explains a minimal set of conflicting requirements. It refuses drafts or missing hardware/compile evidence. The three golden requests—fridge monitor, presence alert and plant waterer—pass against explicitly synthetic acceptance catalogues.

**Operating loop.** The merged ingestion service accepts authenticated, bounded batches and acknowledges durable database writes. The rules UI now follows **propose → person confirms → pending device acknowledgment**, with versioned state and safe retry behavior. The real rule-proposal backend, device synchronization and outcome learning remain integration work; the UI is exercised with mocks.

## 3. Value and impact: make the first useful device attainable

Our initial user hypothesis is a maker, small grower or lab operator with a concrete monitoring/control need and no appetite for assembling CAD, firmware, electronics and a cloud dashboard separately. A single request should lead to an inspectable plan and a device the person can understand and change.

This interval reduces specific failure costs: the solver rejects incompatible assemblies, geometry checks catch unprintable details before material is spent, retry-safe ingestion avoids counting the same transmission twice, and confirmed proposals keep the person in control. **The proposed business model is a hardware/build transaction plus recurring cloud operation.** Willingness to pay, customer demand, unit economics and measured time saved remain hypotheses; we claim no customers or revenue at this check-in.

<!-- pagebreak -->

## 4. Technical implementation: pieces that can be inspected today

| Component | Working evidence | Boundary |
| --- | --- | --- |
| **Portal and gateway** | Public example builds; real SQL-backed parts API; anonymous build/message ownership; replayable server-sent events | Example readings are labeled samples. Sign-in and full AI chat are not verified end to end. |
| **M3 parts solver** | Pinned parts/BOM/wiring, current and lifetime budgets, bounded search, minimal conflicts; 59 tests | Local pure core. Production parts, reviewed assembly profiles and passed driver compiles are required before real plans. |
| **Fit spike and 3D viewer** | CadQuery base/lid/hatches, STL/STEP/GLB export; portal orbit/exploded/parts views; shared GLB contract | Hand-placed layouts, nominal dimensions, fixture-backed viewer. No first-print result. |
| **Sensor ingestion** | Standalone service; authenticated, transactional storage, retry receipts, latest readings and usage; real-Postgres tests | Software and container verified. Production service/edge provisioning and a physical sensor path remain outstanding. |
| **Delivery and cost controls** | Migration → registry load → gateway deployment; staging image provenance; LLM-spend alert infrastructure | Alerts notify; they are not a hard API spending cap. Production promotion remains manual. |

### The system boundary

**Build:** request → **AI intake [pending]** → **checked plan [core merged]** → **firmware [pending]** + **enclosure [local spike]** → **physical validation [pending]**.

**Operate:** sensor → **durable ingest [merged, tested locally/CI]** → **live analysis [pending]** → **confirmed rule [UI merged, mocked]** → **device action and confirmation [pending]**.

This separates software evidence from physical evidence. The loop is the product direction, not a claim that the whole loop already runs.

### Physical engineering progress

The enclosure spike covers **5 printer profiles × 9 layouts = 45 configurations**, plus clearance coupons. It generates a base, lid and battery hatch, probe/USB openings, vents and a raised serial QR. Geometry gates check watertightness, a single body, bed fit, overhangs and parametric minimum walls. The GLB exporter now matches the portal viewer's units, axes, node names and lid behavior.

The spike exposed useful failures before printing: a receptacle-sized opening cannot admit the cable's larger plug; port cuts and pilot holes can leave a floor below the required thickness; touching QR modules can make a mesh non-manifold. Those findings changed the generator and identify missing mechanical metadata for the registry.

**132 CAD tests pass.** The originating spike reports all 45 configurations passing lint. All five printer profiles are uncalibrated; dimensions are nominal; the fit-results log contains **zero physical measurements**. The proposed ≥90% first-print fit rate is a target, not a result.

<!-- pagebreak -->

## 5. Quality: evidence at the captured main revision

| Automated layer | Passing tests | What they protect |
| --- | ---: | --- |
| Web | 523 | Rendering, request/credential handling, rules state, viewer and stream helper |
| Gateway | 137 | Ownership, admission, idempotent messages, replay and stream limits |
| Registry | 125 | Part contracts, catalogue, cross-part validation and loading |
| Matcher | 59 | Feasibility, power, wiring, minimal conflicts and bounded search |
| Database | 11 | Migrations, constraints and restricted-role behavior |
| Ingestion | 16 | Transactional writes, replay, identity isolation and failure handling |
| Deploy scripts | 53 | Freshness, provenance, credentials and ordered delivery |
| CAD spike (local, outside CI) | 132 | Geometry, printability, export and viewer contract |
| **Total** | **1,056** | **871 TypeScript + 53 shell + 132 Python** |

The main-head [CI run](https://github.com/guitarpastdusk/albusforge/actions/runs/34770923427) passed all **5 jobs**: application checks, web image smoke, gateway/database image smoke, ingestion image smoke, and deploy scripts. Web tests increased from the **152 reported at Check-in 1 to 523**; deploy-script checks increased from **25 to 53**.

Independent review closed concrete defects: credential leakage on redirected stream requests, concurrency/replay edge cases, and an order-dependent solver evidence log. For the matcher, the committed 120-catalogue oracle and a reviewer's separate 160-catalogue oracle checked feasibility and ranking. These generated cases are not additional test-count entries or hardware measurements.

## 6. What judges can inspect now

1. **Visit [albusforge.ai](https://albusforge.ai)** and [Marketplace](https://albusforge.ai/marketplace): example builds and explicitly labeled sample readings. Both returned HTTP 200 in this audit.
2. **Open the [live parts API](https://albusforge.ai/v1/parts):** 12 versioned draft definitions. The same API works on [staging](https://staging.albusforge.ai/v1/parts). Draft status is intentional, not production approval.
3. **Inspect the [solver](../../apps/matcher/README.md), [fit spike](../../spikes/fit/README.md), and [ingestion contract](../TELEMETRY-INGEST.md):** executable tests, bounded assumptions and known limitations.

The latest staging web deployment succeeded at `cbfaa17`; the preceding staging gateway/database deployment succeeded at `ddd2d12`. We do not infer production's exact image revision from a passing staging workflow.

## 7. Next check-in: prove a narrow physical journey

**First, finish the conversational path.** Land and revalidate the intake and portal-chat PRs, then demonstrate one real request producing a persisted structured spec with visible assumptions and metered model calls.

**Then, turn software evidence into hardware evidence.** Measure and promote a minimal set of parts, establish real driver/assembly compatibility, print one enclosure and log fit, and flash one sensor that delivers authenticated readings. That is the gate before claiming first-print success or a working physical loop.

**Finally, connect action to outcome.** Wire the live dashboard and confirmed rule backend to a device acknowledgment. Demonstrate one bounded, person-approved action and the subsequent sensor reading that confirms its effect. Telemetry rollups/retention (PR #40) and firmware-target decisions (PR #35) remain separate pending work at this snapshot.

*Prepared against the Team Playbook's four judging categories: innovation 30%, implementation 25%, impact 25%, communication 20%. Claims describe the captured build, not the promised finished product.*
