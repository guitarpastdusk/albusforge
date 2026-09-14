# Native camera accepted-plan compiler

The shared accepted-plan decoder now resolves both the existing BH1750 candidate
and the native Freenove ESP32-S3 N16R8/GC0308 candidate. Camera compilation remains
disabled by default. No camera registry parts, physical assembly evidence, or
provisioning profiles are activated by this change.

## Approval boundary

`CAMERA_PLAN_APPROVALS` is a JSON array supplied identically to gateway and fwbuild
through reviewed Terraform configuration. Its default is `[]`. Each reviewed
entry contains:

- `candidate_id`: exactly `freenove-esp32s3-n16r8-gc0308-usb-v1`.
- `assembly_profile`: exact `{id, version}` for the approved assembly.
- `part_versions`: the complete exact part pin list.
- `evidence_sha256`: canonical SHA256 of the complete accepted plan evidence,
  including active part definitions, assembly/ports, connectors, and passed
  driver/runtime compatibility.
- `wiring_sha256`: canonical SHA256 of the accepted plan wiring graph.

The exported `canonicalDigest` in `apps/codegen/src/accepted-candidate.ts` computes
these identities by sorting object keys and preserving array order. These hashes
identify reviewed evidence; computing a hash does not approve hardware. A physical
review must establish the board variant, camera/SD GPIO mapping, N16R8 memory,
GC0308 image correction, power budget, native capture/upload reliability and exact
registry/provisioning sources before an entry is approved. Synthetic test
snapshots and their hashes must never be put in deployed configuration.

The resolver independently requires runtime 0.3.0, active pinned parts, passed
compatibility for every supplied driver, matching accepted metadata/profile/parts,
Wi-Fi, USB power and exactly 900 seconds. Templates, runtime, channels and
capabilities are fixed in reviewed source and cannot be supplied by the request or
approval JSON. The resulting Plant A manifest has four fixed numeric channels and
two 900-second capabilities: `camera`/`jpeg.v1` with 320×240/1MiB limits and
`environment`/`readings.v1` for light, temperature, pressure and humidity. Soil
remains outside the candidate until its physical protocol and calibration are
reviewed.

## Runtime behavior

The gateway applies the resolver to availability, enqueue, retry, edits and
source rendering. Historical source is rendered from its own stored plan rather
than the current plan or a numeric default. Camera edits must preserve 900 seconds;
BH1750 retains its existing 10–86400-second bounded edits and accepted power floor.

The worker resolves again before selecting the native compiler. Before any passed
record is published, it checks build/plan/code identity, candidate/runtime,
channels/capabilities, canonical manifest bytes/digest, generated source/digest,
and each binary's length and digest. It revalidates current accepted evidence and
approval during publication under the build lock and retains the existing lease
fence. Provisioning also checks passed-record candidate against manifest profile.
No alternate enrollment route is introduced.

Approval changes must use reviewed Terraform rollout for both gateway and worker.
Drain existing compiler executions when revoking an approval; an already running
immutable revision retains its startup configuration. Registry/provisioning
activation remains a separate reviewed prerequisite for issuing camera credentials.

## Compiler packaging and verification

The dedicated compiler Dockerfile resolves Espressif components against the
committed camera dependency lock in a pinned ESP-IDF 5.5.3 stage, verifies the lock
is unchanged, and copies the resolved components into the final image. Compilation
uses `/app/firmware/esp32s3-camera`; numeric compilation keeps
`/app/firmware/esp32s3`. The CI worker image test compiles the packaged camera with
`--network none`, proving no component download is needed at execution time.

Focused resolver tests cover absent/ambiguous approvals and evidence/runtime/cadence
drift. Gateway/worker database tests cover denied/approved enqueue, camera compiler
dispatch, current/previous camera source, fixed cadence edits, tampered job/output
and stale-plan publication, alongside the existing numeric regressions. The
separate native camera CI verifies binary flash header and partition layout.

## Worker admission and release signals

Terraform selects `FIRMWARE_DISPATCH_MODE=scheduler` for the deployed gateway.
Requests enqueue rows without invoking an additional job; the recovery scheduler
executes one task with zero retries on its reviewed cadence. The legacy `direct`
mode remains the default for existing deployments and local tests.

Each worker tries one global PostgreSQL advisory lock on a dedicated session.
Contending executions exit without claiming rows. The lock stays held throughout
compilation; connection error/end aborts the compiler process group, awaits process
closure and prevents artifact publication. The final publication transaction runs
on that same dedicated connection, so transaction and lock ownership end together.
The existing code-bundle row lease independently fences retries. The two-connection
pool leaves one connection for ordinary SQL while reserving one for ownership.
This controls active compilation, not a hard global bound on transient Cloud Run
executions or admission connections.

The job emits an identifier-free `firmware_build` event with outcome `passed`,
`failed`, `idle`, or `busy`. A successful Cloud Run execution can mean idle/busy or
an application failure whose failed row was recorded; it is not evidence that a
specific firmware artifact compiled or passed physical acceptance. Release evidence
must identify the passed code-bundle manifest and matching artifacts separately.
