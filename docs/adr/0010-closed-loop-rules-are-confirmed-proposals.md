# 0010 — Closed-loop rules are proposals a person confirms; changes reach the device on its next check-in

**Status:** Proposed, 2026-09-13

## Context

The device dashboard shows "Closed loop · actions": the rules a device acts on — drive an actuator (SERVO), call an integration (API), or hand over to a person (ALERT). PORTAL.md §3 left the write side open: `PATCH /v1/devices/:id/actions/:actionId` was "proposed, not implemented", the live card was read-only, and PORTAL.md §8 listed alert rules under "not designed yet". CLOUD-PLATFORM.md §7.4 and PORTAL.md §3 already state the principle — a rule written in plain words "becomes a proposal a person or policy confirms, never a direct write" — but no route, type or screen carried it.

Three constraints shape the answer:

1. **A rule moves things.** An irrigation valve, an exhaust fan, a text at 3 a.m. A model's reading of "water when it's dry" must not become a running rule without a person seeing the reading.
2. **Downlink has no broker until M8.** Changes ride back on the device's next `POST /ingest/v1` response (CLOUD-PLATFORM.md §3.4). Latency is the post interval: minutes. A switch that flips green on screen is not yet true on the device.
3. **Tier 0 runs offline.** Threshold and range rules execute in generated firmware with no network (CLOUD-PLATFORM.md §7.1). The cloud is the editor and the record, not the executor, for SERVO rules.

## Decision

### Two-step writes

- **Propose, then confirm.** `POST /v1/devices/:id/actions/proposals { text }` reads a plain-words rule against the device's channels and returns an `ActionProposal`: normalized `rule`, `kind`, `via`, a `summary` in words, and `issues` (a channel the device doesn't have, a missing threshold, a value outside the channel's valid range). It writes nothing. `POST /v1/devices/:id/actions { proposal_id }` creates the rule; it is the only way a rule is created. A proposal with issues is refused with `409 unresolved_proposal`; an unknown or expired one is `404`. Proposals expire after ten minutes.
- **The person confirms the reading, not the words.** The card shows the proposal exactly as the service understood it. Model output never becomes a rule without that step, matching the `create_work_order` pattern in CLOUD-PLATFORM.md §7.4.
- **Enable and disable are direct but audited.** `PATCH /v1/devices/:id/actions/:actionId { enabled }` needs `operator` or `admin` on the device's tenant (ADR 0009), writes an `audit_log` row, and returns the rule.

### Sync state is explicit

- Every write returns the rule with `sync: "pending"`. The device acknowledges rules on its next check-in; the ack flips `sync` to `"synced"` and is what the dashboard shows afterward. The portal marks pending rules "applies at next check-in" and never presents a change as live before the device has it.
- `sync` is optional on the wire so older dashboards still parse; absent means synced.

### Permissions ride on the dashboard

- `GET /v1/devices/:id/dashboard` carries `permissions: { edit_actions }`, resolved by gateway from the session's role on the resolved tenant. Absent means read-only. The portal disables switches and the composer and says why; it never infers rights from the client.

### What the portal does

- Switches change optimistically and roll back on a refused or failed write, showing the refusal. A `501` from gateway reads as "not connected for this device yet"; a `403` as a role problem.
- The card is shown whenever the device has rules or the session may add the first one, so a freshly provisioned device has its rules screen before its first reading (CLOUD-PLATFORM.md §6.1).

## Consequences

- Gateway needs: `actions` and `action_proposals` tables (or a proposals cache with TTL), `audit_log`, role checks per ADR 0009, and the ack path from ingest's response into `sync`. `PATCH` and the confirm `POST`, with `audit_log` and the `409` while issues remain, live in the gateway.
- **The proposal reader does not run in the gateway.** The gateway is the public tier and holds no LLM key: only intake does (internal-only, called with an ID token). For `POST /v1/devices/:id/actions/proposals` the gateway authorizes the request, resolves the tenant from the session, checks `operator`/`admin`, loads the device's channels, and calls an internal service with that context — a new intake route, or a small internal assist service. That service runs `callStructured` through `packages/llm`, meters `llm_calls` under its own stage (`actions`), and returns the `ActionProposal` shape, issues included, never a rule. The gateway writes nothing for proposals. If proposals get their own service, infra needs its name and spend budget; its `llm_call` log lines feed the existing `llm_cost` metric through the stage label.
- Ingest (the separate cloudlink service, ADR 0003) piggybacks pending rules onto its response and records the device's ack. Every rule carries a `version` that increments on each write; cloudlink flips `pending → synced` only for the version the device acknowledged, writing through `packages/db` with the app role, so a replayed or late ingest cannot regress a newer pending change. Until that path exists every rule stays `pending`; the portal's copy is honest about it.
- A tenant-wide rules screen (every rule across devices, PORTAL.md §8) is not designed here. Its rows are the same `DeviceAction` shape.
- Real-time actuation from the portal stays out of scope until MQTT (M8). Nothing in this ADR promises it.
