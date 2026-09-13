# matcher

M3's pure deterministic core: `solve(input)` returns ranked pinned build plans,
an inclusion-minimal conflict set, invalid input, or a search-limit result.
It makes no network/database/model calls and starts no server.

```ts
import { solve, fromIntakeSpec } from "@albusforge/matcher";

const result = solve({
  spec: fromIntakeSpec(storedSpec, "0.1.0"),
  parts, connectors, profiles, compat,
});
if (result.status === "solved") {
  const plan = result.plans[0];
  // Persist only after gateway verifies that this spec version is still current.
}
```

The exports are TypeScript source, as with the other workspace packages; `build`
also produces a standalone ESM `dist/index.js`. `SolveInput` and `AssemblyProfile`
validate the complete input. Parse failures return `invalid_input`. The intake
adapter throws for unsettled/incomplete specs or unsupported environmental and
accuracy requirements. It reads M2's `capabilities`, never infers parts from the
free-text `sense.what`/`act.what` arrays. This adapter is local until the shared
M2 `Spec` contract lands; it doesn't edit the intake team's schema files.

## What a plan guarantees

- Only `active` definitions are selectable; one host, one power source and at
  most one version/instance of each part ID. All pins and the runtime are explicit.
- Requested capabilities and transport are covered. Every selected part's
  `requires` is satisfied, host bus/IO requirements are checked, conflicts are
  enforced in both directions, and I2C addresses are unique on one logical bus.
- Runtime ranges follow the schema's exact/`>=`/`^`/`~` grammar. Every driver has
  an exact `(driver_pkg, driver_ver, runtime_ver, brain_id)` entry with status
  `passed`. A missing, pending or failed compile excludes that assignment.
  The future DB adapter must explicitly map its status vocabulary to this one.
- Signal levels fit the host. Each peripheral gets a compatible connector and
  interface on a profile port. Different ports cannot allocate the same physical
  resource. Only I2C ports can share a connection, within their capacity and
  aggregate peak current. No implicit adapters, level shifters or bus expanders.
- Peripherals operate over the **entire** supplied voltage window. Source,
  regulator (including the host itself), and port peak-current limits are
  checked assuming simultaneous activity. Power requirements refer to the
  actual rail a peripheral is wired to.
- BOM prices come from the pinned definitions. Ranking uses cost, average
  source current, part count, then stable identifiers. It searches all modeled
  subsets/profiles and keeps the lowest-current valid port allocation per pair.
  `feasible_count` counts feasible subset/profile pairs, not wiring permutations.

## Hardware evidence is an input

`PartDefinition` describes a component, but doesn't describe host output
connectors, adapters, pin allocation, measured duty cycles or regulator losses.
An `AssemblyProfile` supplies that missing assembly contract. It pins the brain
and source versions, the source's connector and the brain input, and identifies
the reviewed wiring evidence (including any source-to-brain cable/adapter).
Its ports list the peripheral connector, signal interface, rail, physical
resources, current limit and capacity. A profile is trusted engineering input,
not something intake or an LLM may invent.

Profiles also provide minimum measured regulator efficiency and unmodeled
source-side quiescent draw. Host `current_draw_ma` is interpreted as draw on its
regulated rail; peripherals use their assigned rails. Regulated power is referred
back to source current at minimum usable source voltage. A device runs at its
full active current unless an exact pinned activity entry supplies a measured
active duration: `duty = min(1, active_s / interval_s)`. This does not grant an
actuator or always-on sensor a sleep mode merely because the sensing interval is
long. Part values are typical estimates, so this is a model, not a fit/safety or
battery-life certification.

Battery capacity is reduced by the profile's measured usable fraction (cutoff
and reserve). A battery may sag below the brain input minimum: the plan operates
only above that cutoff and **must** use a measured capacity fraction for that
window. A non-battery supply may not brown out. Battery life is
`usable_capacity_mah / average_source_ma / 24` days; the architecture previously
multiplied by 24, which was dimensionally wrong. Zero-draw battery lifetime is
unknown (`null`), and cannot satisfy a finite lifetime target.

## Search, infeasibility and limits

The catalogue is bounded to 24 pinned definitions and 32 profiles. Search has
a shared budget (default 100,000 steps, maximum 1,000,000) covering subset
enumeration, wiring and conflict minimization. Hitting it returns `search_limit`,
without claiming infeasibility or returning a possibly non-optimal plan.

An infeasible result minimizes requested capabilities (including transport) and
the battery-life target by deletion while keeping hardware/compile evidence,
runtime, interval and source domain fixed. Removing any remaining requirement
makes the reduced problem feasible: **inclusion-minimal**, not necessarily the
smallest cardinality conflict. An empty set means even a host/source assembly
cannot be validated; the catalogue/evidence needs work. Diagnostics are bounded
examples of rejected assignments, not a claim that every alternative has every
listed fault. `explanation` is deterministic text for a future trade-off UI.

## Current registry and remaining integration

All twelve checked-in parts are drafts. There are no production assembly
profiles or passed compiler-matrix fixtures here. The three golden requests
therefore correctly fail against the real registry. Acceptance tests use
explicitly **synthetic** active definitions, harnesses, measured values and
compile outcomes. They do not promote parts or claim physical verification.

This slice does not add HTTP routes, persistence, deployment, M2's solver
sensitivity callback, a shared `BuildPlan` API schema, or portal plan cards.
Those follow the M2 contract integration. Multi-stage power/charging, solar
energy yield, environmental/accuracy guarantees, multiple identical parts,
pin-preserving remix, and electrical level shifters need additional models.
`solar` selects only a verified `power.solar` supply/profile; it cannot imply a
nighttime energy store or autonomy guarantee. Unknown request keys are rejected.

## Checks

```sh
pnpm --filter @albusforge/matcher typecheck
pnpm --filter @albusforge/matcher lint
pnpm --filter @albusforge/matcher test
pnpm --filter @albusforge/matcher build
```

Tests cover the three golden builds, rejection of real drafts, individual hard
constraints, battery dimensions, minimal conflicts, deterministic ordering,
budget exhaustion, and 120 generated small catalogues checked against an
independent exhaustive feasibility/cost oracle. No API credentials or hardware
are required.
