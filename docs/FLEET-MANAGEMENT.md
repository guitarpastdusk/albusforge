# Fleet management

The `/live` monitor supports tenant-bound display-name/device-ID search, current-status filters and UUID cursor pagination. Device detail lets current operators and admins edit an optional display name. Viewers see the name but cannot edit it. Labels are presentation metadata: channel IDs, source mappings, provisioning tokens, firmware and telemetry are unchanged.

## Contract and rollout

Migration `0005_fleet_metadata.sql` adds nullable `telemetry.devices.display_name`, integer `metadata_version` (initially zero), and a `(tenant_id, id)` cursor index. Apply the migration before deploying the gateway, then deploy the web application. Existing readers receive the exact previous list/detail payload: new fields are emitted only with `presentation=1`. New web uses that opt-in; it requires the updated gateway. This avoids additive fields breaking already-deployed strict Zod clients.

`GET /v1/telemetry/devices` accepts `presentation=1`, optional `q` (trimmed, at most 80 characters), optional `status=online|offline|never_seen|revoked`, `after=<UUID>` and `limit=1..100` (web uses 50). Search is a case-insensitive **literal substring** of display name or device UUID; `%` and `_` are ordinary characters, not SQL wildcards. All values are bound parameters. A revoked device matches the revoked filter even if it never sent a packet.

Each cursor request is a fresh authorized read. Concurrent names/status changes can change membership between pages; pagination is not a frozen export. The page reports only the number shown, never a fleet total. Applying filters starts at the first page; next/first/refresh links preserve the selected filters. The cursor index bounds traversal, but substring search can scan the selected tenant's devices; large-fleet search optimization should follow measured query costs.

`GET /v1/telemetry/devices/:id?presentation=1` adds `device.display_name`, `device.metadata_version` and `permissions.edit_metadata`. The permission is a rendering hint; writes independently authorize current membership.

`PATCH /v1/telemetry/devices/:id/metadata` accepts only:

```json
{"display_name":"Boiler room","expected_version":0}
```

A name is trimmed and limited to 80 characters; `null` clears it (the web maps blank input to null). Success returns `{device_id, display_name, version}` with the incremented version. A stale version returns `409 METADATA_CONFLICT` without overwriting another edit. Unknown and foreign devices return the same 404 after authorization. Missing/invalid/revoked/expired sessions return 401, insufficient roles or invalid origins return 403, invalid input returns 400, and managed database deadlines return the existing bounded service error. Responses are private and `no-store`.

## Mutation safety

The Next Server Action checks the incoming Origin against Host, sends only the established session cookie to the configured gateway, and supplies that gateway's own origin. The gateway independently rejects missing or mismatched Origin. HTTPS is required except loopback development. Forwarded-host headers are not a trust source for the added mutation guard.

The shared managed write transaction uses a fenced PostgreSQL client with bounded checkout/query/cleanup and transport-failure handling. It locks the session ancestry in ID order, verifies revocation/expiry, resolves the tenant from the existing host/session rules, and locks current membership before the versioned update. Those locks serialize an admitted edit with session revocation and role removal/downgrade. Expiry is checked again after a possible device-row wait. A revocation or downgrade committed ahead of admission denies the edit; a previously admitted edit may finish before the revocation acquires its lock.

The editor waits for an acknowledged write and refreshes authoritative state. Conflicts, access changes and uncertain save outcomes require a refresh before another edit. No optimistic success or automatic mutation retry is used.

## Diagnostics and boundaries

Current online/offline status continues to derive from the last durable packet receipt and the existing `max(60 seconds, 3 × next_s)` grace period. Never-seen, revoked, last-packet time and latest sample timestamps remain distinct. Missing health is explicitly reported; battery/history/provenance are not invented. There is no historical uptime claim or alerting engine.

Device detail links to `/setup?device=<UUID>`, delivered by the separate existing-device setup PR #69. That route confirms cloud reception for already provisioned devices; this fleet change does not enroll devices or mint credentials. Coordinate those deployments if enabling the link before the setup route is available.

## Acceptance evidence

Real PostgreSQL tests exercise legacy response compatibility, tenant isolation, operator/admin/viewer policy, immutable provisioning fields, strict input/origin/session validation, stale concurrent edits, literal search, filtered cursors, revoked precedence, and revocation/role-downgrade lock schedules. The committed `apps/web/e2e/fleet-management.spec.ts` runs against production Next, the actual gateway and disposable PostgreSQL. At 320 and 1440 pixels it signs in, pages a 52-device fleet, resets the cursor through literal search, edits a name through the Server Action, resolves a concurrent edit conflict, and verifies viewer denial in the UI and directly at the gateway. It also checks horizontal overflow and browser errors. This establishes software behavior, not production-scale load or physical device validation.
