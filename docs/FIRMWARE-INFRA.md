# Dedicated firmware compiler rollout

Source definitions only; no Terraform apply or compiler deployment is implied.
The coordinator roster and apply procedure are in
[ARCHITECTURE §12.3.1](ARCHITECTURE.md#1231-who-applies-terraform).

## Resources and admission

Each environment gets a private `${project}-firmware-artifacts` Standard bucket,
`fwbuild` job, runtime identity, restricted SQL secret access, and paused
quarter-hour scheduler. Gateway has object-get only; the compiler has object
create/get only, with create-only generation preconditions in the artifact
adapter. Neither can overwrite or delete objects. Public access is prevented;
versioning is off and soft delete is explicitly seven days. No upload-age expiry
is applied: passed build downloads currently have no expiry contract. The 1 GiB
capacity alert includes soft-deleted bytes, is delayed, and is not a spending cap.

`firmware_builds_enabled=false` keeps gateway cloud build admission off and the
schedule paused. `camera_plan_approvals=[]` is shared by gateway and compiler.
Enabling the compiler does not approve a camera profile. Only reviewed immutable
physical evidence pins may populate the approval list; draft registry data and
synthetic test fixtures are not approval evidence.

Cloud gateway uses `FIRMWARE_DISPATCH_MODE=scheduler`: requests create durable
queue entries, without permission to invoke the job. The scheduler starts at
most one task per invocation every 15 minutes, with no scheduler or task retry.
One invocation handles one queue row. Expect up to a quarter-hour admission wait
plus startup and compilation; sustained arrival above four builds/hour requires
a separately reviewed capacity change, not a faster unbounded dispatcher.

The job has 2 vCPU, 4 GiB memory, an 840-second task timeout and two SQL connections.
The compiler's own deadline is 600 seconds and the durable row lease is 15 minutes.
The worker holds a dedicated advisory-lock connection throughout compilation;
losers exit promptly. Publication uses that same session, so loss of the lock
cannot let a superseded worker publish. The second connection serves ordinary
queue/database work. This limits active compilation, not global Cloud Run
execution count. Delayed startup, manual execution and shutdown boundaries can
still overlap admission connections.

## Capacity and activation evidence

Reserve four compiler connections as an operational allowance for overlapping
executions, **not a hard global cap**. Adding this to the documented sensor base
reservation (40 staging / 266 production) and observation job allowance (2) gives
46/50 staging and 272/400 production. These are planning figures from the existing
capacity review, not new measurements or load certification. Preserve the current
SQL alert thresholds (37/320); investigate real connection counts before activation.
Drain manual jobs and old service revisions during rollout. Do not increase
staging max_connections or enable higher queue throughput to hide saturation.

1. From merged main, the coordinator reviews fresh plans with the committed
   environment var-file, drains relevant deploy workflows, and applies disabled
   resources. Existing sensor/Ask activation settings must remain intact.
2. Run the gateway-owned matching migration/grant release. No firmware workflow
   updates or executes the shared migration job.
3. Dispatch `deploy-fwbuild` on main. It requires successful exact-source CI and
   pinned native-camera compiler CI, existing Terraform jobs, matching migrations
   and freshness before building/publishing the compiler image. It updates only
   the image, executes once and records the immutable staging certification tag.
4. A successful idle execution proves startup, not firmware compilation. Before
   activation, verify an authorized accepted-plan fixture through enqueue,
   execution, immutable artifact download and digest checks; measure the SQL
   connection allowance and lock-loss recovery. Keep camera physical approval
   separate from the numeric compiler infrastructure acceptance.
5. Commit reviewed activation values and have the coordinator apply them.
   Confirm the quarter-hour schedule and bounded `firmware_build` outcome logs.
   Failed compilations can be recorded by a successful Cloud Run execution;
   alerts therefore cover both application failure events and platform failures.
6. Production uses `promote-fwbuild` with the accepted staging image digest,
   never a rebuilt image. Require matching production migrations and completed
   staging evidence before promotion. Pause and drain the schedule around manual
   job rollout/acceptance to avoid accidental overlap.

Rollback disables new queued builds and pauses the schedule through committed
Terraform values. Preserve passed artifact objects and database references.
Existing immutable downloads remain authorized through gateway. Do not delete
buckets or weaken accepted-plan validation as a rollback mechanism.

## Private device configuration handoff

The empty Secret Manager `device-handoff-keys` resource supplies the existing
AES-256-GCM one-time configuration handoff, separate from credential-free compiled
artifacts. `device_provisioning_enabled=false` omits both the gateway secret mount
(and its accessor binding) and `DEVICE_INGEST_URL`; existing read/revoke operations
remain available. Enabling adds the keyring mount and the same environment's
`https://DOMAIN/ingest/v1` endpoint together. Approved provisioning profiles are
still the reviewed, currently empty, checked-in registry file. This flag does not
activate a hardware profile or change camera cadence.

After the coordinator creates the empty secret, seed its value outside Terraform
through a private operator process before enabling the mount. The JSON format is
`{"active":"key-id","keys":{"key-id":"<canonical 32-byte base64url key>"}}`.
Generate a fresh cryptographically random 32-byte key; send it to Secret Manager
through stdin or a protected temporary file, never command arguments, source,
Terraform variables/state, terminal output or PR evidence. Pin the environment
explicitly and verify only the created secret version metadata. No key or secret
version is created by these source definitions.

Set the nonsecret `device_handoff_key_version` to the seeded numeric Secret
Manager version before enabling handoffs. Terraform pins that version rather
than `latest`, so key changes require a reviewed configuration change and gateway
revision. The keyring supports one to four keys. No private key enters the var-file.

For uninterrupted rotation, first publish a keyring containing both keys with
the old key still active. Commit its version, have the coordinator apply it and
drain every old-only gateway instance. Then publish a keyring with the new key
active and both decryption keys retained; commit/apply that version. Keep the old
key until old-active revisions drain plus the final ten-minute handoff window.
Only then publish/roll a version that removes it. Switching active in the first
rollout can send an encrypted handoff to an old instance that cannot decrypt it.
Creating a secret version alone does not refresh existing environment values.
Follow the coordinator's workflow drain and shape-change procedure for each apply.
Reissue expired or deliberately invalidated handoffs through the authorized
application flow. See [device provisioning](DEVICE-PROVISIONING.md) for binding,
once-only download, replacement and revocation semantics.
