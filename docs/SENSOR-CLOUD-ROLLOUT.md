# Sensor data and conversational Ask rollout

This is the implementation and rollout ledger for the user-authorized single-sensor chatbot work on 2026-09-13. A user selects one of their sensors, selects its channel and time window, and asks questions about its stored measurements. The first slice uses a small hosted language model for bounded intent interpretation and deterministic queries/rendering for numerical evidence.

## Active rollout snapshot — 2026-09-13, 23:23 UTC

The earlier inventory, PR ownership states and local tests below remain historical evidence at their stated timestamps/commits. They are not overwritten by this execution record. Current architecture and deployment are distinct: implementation is merged; deployment and acceptance proceed in stages.

| Evidence | Observed result | Remaining boundary |
| --- | --- | --- |
| Capacity controls [#60](https://github.com/guitarpastdusk/albusforge/pull/60) | Merged as `d8c81b2`; staging caps fit the measured 50-connection server | Idle capacity is not a load test |
| Observability [#61](https://github.com/guitarpastdusk/albusforge/pull/61) | Merged as `6ebe7fa`; exact breach counters avoid distribution-bucket threshold bias | Runtime signals and notification delivery still need acceptance |
| Acceptance tooling [#59](https://github.com/guitarpastdusk/albusforge/pull/59) | Merged as `6003b6a` | Committed probes do not establish that cloud acceptance passed |
| Maintenance alert correction [#66](https://github.com/guitarpastdusk/albusforge/pull/66) | Merged as `ce675bf`; supported 25-hour history | Historical plans before this correction are not current desired state |
| Staging infrastructure | Root reports provisioned and converged; model disabled, schedules paused | Bootstrap resources alone do not establish working sensor ingestion or Ask |
| Staging intake, source `03f40c1` | [Run 34789264756](https://github.com/guitarpastdusk/albusforge/actions/runs/34789264756) succeeded; revision `intake-00009-klg`, digest `cd7e9b008ad4262bc36fd6757628af510d235812d0e6b949014a5a72a4ef6cbc` | Intake deployment is separate from the sensor Ask runtime |
| Staging gateway/schema, source `03f40c1` | [Run 34789222331](https://github.com/guitarpastdusk/albusforge/actions/runs/34789222331) succeeded at 23:23:20 UTC, including owner migration, registry load, gateway deploy and immutable staging marker steps | Exact serving digest inventory and integrated acceptance are recorded separately when collected |
| Sensor runtime/job images | Deployment evidence not yet recorded in this snapshot | Cloudlink, Ask and processing runtime promotion/acceptance remain pending |
| Production | Read-only preflight at `03f40c1`, 23:18:41 UTC: 54 creates, 2 updates, no deletes/replacements; only gateway Ask URL and edge route update, existing images unchanged | No production mutation. Preflight is explicitly not applyable; fresh plan follows the complete production drain |

The production preflight confirmed SQL alert threshold 320, model disabled and schedules paused. New sensor resources use the module bootstrap placeholders until release workflows promote immutable images. Its private plan hash is `9b681a90758d3ca0bc3d41bda3afde41d2ca751d327e2b681a44fc5549f01221`; the hash identifies inspection evidence, not an apply artifact. Refreshed registry-load drift was execution count/latest execution metadata only, with no desired job configuration update.

Named nonsecret initial configuration is committed as [`rollout-staging.tfvars.json`](../infra/env/rollout-staging.tfvars.json) and [`rollout-prod.tfvars.json`](../infra/env/rollout-prod.tfvars.json). The [environment runbook](../infra/env/README.md#initial-sensor-rollout-configuration) requires the explicit private base plus matching environment file and the reviewed workflow/job exclusion window. Staging reservations remain 40/50 connections including observer/reserved slots; production's one-retry/600-second rollup bound is approximately 266/400. Those are capacity reservations, not demonstrated throughput.

No physical sensor, real-provider chatbot, complete deployed portal journey or production acceptance is claimed by this snapshot. Later rollout updates append exact evidence here and change activation flags only after the corresponding acceptance gates pass.

## Existing implementation and observed cloud state

Merged foundations: standalone ingest (#32), partitioned storage and rollup/retention code (#40), live portal UI (#42), authenticated telemetry read APIs (#44), gateway sign-in/session issuance (#45), and intake/model infrastructure (#37). A merged PR proves repository state, not that its services or jobs have been deployed.

Read-only Cloud Run and Cloud Scheduler inventory on 2026-09-13 at approximately 20:49 UTC, `us-central1`:

| Environment | Latest ready service revisions | Jobs | Scheduler jobs |
| --- | --- | --- | --- |
| staging | `gateway-00014-rxr`, `intake-00002-bfb`, `web-00028-cl9` | `db-migrate`, `registry-load` | none |
| prod | `gateway-00004-sj8`, `intake-00001-z8n`, `web-00010-bf4` | `db-migrate`, `registry-load` | none |

No `cloudlink` or sensor Ask service, telemetry rollup job or maintenance job was listed in either environment. These revision names are inventory evidence only: they do not attest to traffic allocation, image provenance, database migrations or working physical devices. Promotion of the existing production gateway is a separate deployment decision.

## Historical implementation ownership and PR boundaries

| Workstream | Branch / isolated tree | Scope | State |
| --- | --- | --- | --- |
| Sensor cloud infrastructure | `codex/sensor-infra`, `/private/tmp/albusforge-sensor-infra` | Cloudlink, Ask runtime, scheduled database jobs, IAM/network/edge, delivery workflows and operational controls | [PR #52](https://github.com/guitarpastdusk/albusforge/pull/52), review pending |
| Sensor Ask backend | `codex/sensor-ask`, `/private/tmp/albusforge-sensor-ask` | Internal Ask contract, scoped query execution, small-model intent selection, evidence, persistent request budgets and metering | [PR #54](https://github.com/guitarpastdusk/albusforge/pull/54), review requested |
| Gateway and portal | `codex/sensor-gateway`, `/private/tmp/albusforge-sensor-gateway` | Session-authorized Ask bridge and sensor chat controls mounted on the independently developed telemetry monitor | [PR #53](https://github.com/guitarpastdusk/albusforge/pull/53), stacked on UI PR #50; Ask contract integration implemented |
| Architecture and integration ledger | `codex/sensor-architecture`, `/private/tmp/albusforge-sensor-architecture` | This ledger, central architecture boundaries, dependency/review/rollout evidence | [PR #47](https://github.com/guitarpastdusk/albusforge/pull/47), review pending |

The separate UI agent's [PR #50](https://github.com/guitarpastdusk/albusforge/pull/50) supplies the paginated telemetry fleet and bounded raw/rollup history monitor using the existing read API. The Ask integration adopts those pages; it does not add a second set of richer dashboard/fleet adapter endpoints. [PR #51](https://github.com/guitarpastdusk/albusforge/pull/51) preserves the pre-existing deployed/local spend monitoring correction as a separate infrastructure prerequisite, leaving the original shared-checkout file untouched.

Every workstream has a dedicated PR. The gateway integration stacks on UI PR #50 and also requires the Ask service/schema PR before deployment. Shared architecture changes stay in the architecture branch; service-specific runbooks stay with the service. Code review uses exact commits and does not authorize merging or deploying unrelated work.

## Target data path

```mermaid
flowchart LR
    D[Sensor or simulator] -->|device-authenticated HTTPS| E[Load balancer and Cloud Armor]
    E --> C[Cloudlink]
    C -->|durable transaction then acknowledgement| DB[(Private PostgreSQL)]
    S[Cloud Scheduler] --> R[Rollup job]
    S --> M[Maintenance job]
    R --> DB
    M --> DB
    U[Authenticated user] --> W[Sensor dashboard and chat]
    W --> G[Gateway]
    G -->|authorized telemetry reads| DB
    G -->|service identity and bound user/tenant/device| A[Internal Ask service]
    A -->|bounded tenant-scoped queries| DB
    A -->|bounded intent request| L[Hosted small model]
    A -->|verified evidence and answer| G
```

The ingest acknowledgement continues to mean durable SQL acceptance. Scheduled rollups process transactionally recorded dirty hours; daily maintenance creates partitions and expires only safely aggregated data. The raw/minute/hour contracts and restricted database roles remain those in [TELEMETRY-STORAGE.md](TELEMETRY-STORAGE.md).

The Ask service receives identity bound by the authenticated gateway and independently checks membership/device scope. The model does not select a tenant, emit SQL or execute writes. Channel/window bounds, query deadlines, result limits, request quotas and token caps apply before a provider call. Request accounting must survive instance restarts and prevent a retry from creating another billable call. Numerical answers refer to the executed query, channel units, sample count and time window; missing data or unsupported questions are explicit outcomes.

The initial UI keeps its transcript within the tab and exposes the current channel/window. If earlier messages are not sent to the model, the UI must say so; it must not promise remembered conversational context. Persistent conversation storage, cross-sensor reasoning, baseline/anomaly analysis and write actions are later work.

## Terraform plan evidence

Infrastructure PR #52 alone produces the same read-only plan counts in both environments: 34 additions, five updates, no destruction. Three updates would revert deployed LLM monitoring to the stale checked-in configuration. Combining the exact pre-existing correction from PR #51 removes those reversions: **34 additions, two updates, no destruction** in both environments. The two updates are the HTTPS URL map and gateway Cloud Run service (`ASK_URL`). Private plans are retained locally; their sensitive contents are not published.

These plans prepare the action; they are not evidence of an apply. Telemetry schedules start paused and model calls start disabled until migration/image verification and staged acceptance are complete. The current production service versions differ substantially from staging; new sensor resources do not implicitly promote the existing gateway/web/intake stack.

## Integration and deployment sequence

1. Review the independent implementation PRs and the stacked schema/gateway dependency at exact heads. Verify the combined checkout builds and tests, not only each branch separately.
2. Review Terraform plans for each environment, accounting for the existing user-owned infrastructure changes. Confirm explicit service caps and a database connection reservation shared by gateway, intake, cloudlink, Ask, migrations and scheduled jobs. Retain headroom for overlapping revisions.
3. Build immutable service/job images. Apply schema migrations before the service that needs them; prepare networking, service accounts, secret references and internal invocation permissions. Never embed API keys or database passwords in source, PRs or plans shared for review.
4. Establish staging cloudlink routing and health, then deploy the rollup and maintenance job images before enabling their schedules. Confirm one-minute rollup and daily maintenance execution, restricted roles, retry behavior and observable failures.
5. Deploy the internal Ask service, then its gateway integration and portal chat. Run model-free staging checks first. A paid provider call is separate evidence and must be explicitly budgeted; fixtures are not a real-provider test.
6. Exercise a provisioned simulator through durable ingestion, latest/history reads and a sensor question. Verify authorization failures for another tenant, duplicate ingestion, delayed samples, retention boundaries, upstream timeouts and exhausted Ask budgets. Record exact image digests, migration state and executed job results.
7. Promote only the reviewed and verified staging images through existing promotion gates. Physical sensor acceptance remains separate from simulator acceptance.

## Local integration evidence

A root-owned combined checkout was assembled from infrastructure `2291d64`, monitoring `47cc606`, Ask `1b3306c`, and gateway/portal `ffef4a1` (including the UI #50 base `a1a9b7e`). The complete workspace `turbo run typecheck lint test build` passed all **36 tasks** (32 cache hits on the final corrective rerun). This includes 27 Ask, 222 gateway, 600 web and 21 database tests. These results apply to those commits, not to later changes on the independent UI branch.

An additional local test used PostgreSQL 16 and actual HTTP servers for cloudlink, gateway and Ask. It ingested two samples, confirmed a repeated packet did not add duplicate rows, ran the rollup worker, read authenticated fleet/latest endpoints, and obtained a sensor answer with verified count 2 and mean 15. Missing authentication returned 401; removed membership returned 403. The model was disabled, so this validates the deterministic fallback and service/data integration, not a provider response. The pipeline passed again on the final combined commits listed above. The temporary test and execution log are retained in `/private/tmp/albusforge-sensor-evidence/`.

The gateway branch also passed a browser check with contract-stub transport at desktop, 390px and 320px widths, including long channel identifiers and Ask evidence, without document overflow or page errors. Infrastructure validation includes Terraform validation/mocked configuration tests, actionlint, and 94 shell checks. Ask failure-path corrections also pass the three independent reviewer reproductions for socket loss, post-body disconnect and pool acquisition deadlines. Infrastructure release-gate corrections pass the three adapted reviewer probes for newer failed/running migrations and imported policy changes. Cloud read-only plans are described above; the final infrastructure delta changes shell guards and docs, with Terraform unchanged from `83eae51`. Review verdicts and current CI belong to each PR's exact head; passing local checks do not substitute for review.

After that combined run, infrastructure `bcc0222` tightened only the release guard, its tests and runbook. It rejects overlapping terminal migration histories regardless of completion order and requires a fresh matching success created after all other observed attempts finished. All **103 shell checks** pass, including the independent reviewer overlap reproduction with only its target path and expected rejection changed. Terraform and application code are unchanged; the earlier combined test and plan evidence remains attributed to its original commits. This corrective delta awaits independent review.

## Acceptance evidence to collect

| Claim | Required evidence |
| --- | --- |
| Ingestion deployed | Traffic-serving cloudlink revision/digest, LB route and authenticated simulator acknowledgement with corresponding database rows |
| Processing operational | Successful rollup and maintenance executions, actual schedules, recent watermarks/backlog metrics and no privilege escalation |
| Sensor reads integrated | Logged-in portal renders that tenant's stored channels/readings; absent metadata has honest labels and unsupported controls remain unavailable |
| Ask integrated | Gateway authorization, internal service invocation, deterministic evidence, bounded model call/fallback, durable quotas and metering |
| Real-provider chatbot | Explicitly budgeted provider call, verified response/evidence and attributed usage; never inferred from mocks |
| Production ready | Reviewed plan, shared SQL budget, migration/rollout order, load/failure checks, alerts, exact promoted image evidence |

## Remaining independent work

Durable event delivery and tenant-scoped SSE are not supplied by the scheduled SQL jobs. The merged live UI's reconnect behavior does not prove a backend telemetry stream. Baselines, anomaly detectors, model-written anomaly narratives, Signals/Inbox, persistent conversations, automated production provisioning/token rotation, and firmware/hardware acceptance remain separate items. The first stored-data chatbot does not require completing those items.

## Authorized deployment preparation, 2026-09-13

The user subsequently authorized staged deployment and production promotion after acceptance. SQL probes through existing VPC-attached registry-load executions confirmed connection limits of 50 (staging) and 400 (prod), including three superuser-reserved slots each. Staging service/pool caps are reduced before provisioning; planned combined reservations are 40/50 and 266/400 respectively, including overlapping revisions/jobs and observer/reserved slots. Current low utilization is an idle baseline, not load evidence. See SENSOR-INFRA for limits and rollout controls. Fresh plans, actual migrations/images, schedules and acceptance evidence must be recorded as execution proceeds; this preparation does not claim deployment.
