# Same-host workspace switching (A3)

The account header now displays the current workspace and role. When `/v1/me` returns multiple memberships, an explicit select-and-Switch control changes the caller's active workspace and opens Projects. Single-membership users see their workspace/role without a switcher. Tenant subdomains do not offer this control; host selection and cross-subdomain session handoff (A4) are separate work.

## Authorization and concurrency

`PUT /v1/me/active-tenant` accepts only `{tenant_id: UUID}` and returns204 after commit. New mutation routes require exact same-host Origin; browser Server Actions validate incoming Origin/Host and then send the configured gateway origin. Unverified forwarded hosts never authorize mutation. Direct or verified tenant-host switching is rejected with409. There is no cookie rotation, domain broadening, user/tenant identity from arbitrary headers, or change to the session family.

The auth store uses a managed READ COMMITTED write lease, sharing the continuous client-error coverage, explicit BEGIN ownership, fenced cleanup and uncertain-client discard established for event polls. It locks the caller's session row before checking its state, takes key-share locks on the relevant membership rows in tenant-ID order, validates session ancestry/expiry after waits, and updates only `active_tenant_id`. The target membership must still exist. A sign-out or membership removal that wins its lock is observed; a change admitted first may finish before a later removal/revocation. Expiry is rechecked using database wall time after lock waits. These short transactions do not span browser navigation or streams.

A valid session whose old active membership was removed can recover by selecting another currently verified membership. An already displayed switcher supports this directly. A freshly loaded `/v1/me` still rejects a missing active membership under its existing contract; re-verifying the account selects an available membership. Foreign or missing target membership returns403 without revealing tenant details; invalid/revoked/expired session returns401. Existing sibling sessions keep their own active tenant. Parent linkage remains intact and family sign-out still revokes descendants after a switch.

## UI state boundary

The session header retains its original Suspense boundary: public page rendering does not await authentication. A client provider wraps header/content coordination. On Switch, it synchronously unmounts tenant content before issuing the mutation, closing mounted streams and abandoning component state. Success performs `window.location.replace('/projects')`, replacing the document, pending component responses and prefetched App Router state. The selected destination is fixed and same-origin. An uncertain response never restores the old tenant tree; it shows a reload action that reconciles the actual session. Browser back/forward cache restoration reloads as well.

Same-origin peer tabs receive begin/finish invalidations through storage events and BroadcastChannel (when available). They clear tenant content on begin and reload on completion. Focus checks persisted revisions to catch missed signals. Messages contain a phase and random nonce, never credentials or tenant data. Independent browser contexts/sessions do not share those signals. If both storage and BroadcastChannel are unavailable, automatic peer-tab coordination is unavailable; the switching tab still replaces its document. Already admitted backend work follows each endpoint's authorization semantics; browser cancellation cannot recall a committed write. New mutation callers must continue to authorize every request.

Existing build streams re-resolve the session in each authorized poll snapshot and stop once the build is outside the active workspace. Earlier admitted messages may finish; later messages cannot enter that snapshot. This change adds no fleet/device routes, provisioning metadata, migrations or deployment.

## Validation

Real PostgreSQL auth tests cover target membership, independent sessions, removed-active-membership recovery, malformed/foreign targets, Origin/host boundaries, concurrent revocation/removal, expiry after waiting, session-family sign-out and old-build stream termination. The shared write lease has real socket-loss and BEGIN/COMMIT/cleanup-stall tests. DOM tests verify unmount-before-dispatch, uncertain-response masking, cross-tab invalidation and focus recovery.

`e2e/workspace-switch.spec.ts` uses the existing production Next/bundled gateway/disposable PostgreSQL harness and local email sink. It verifies two tabs switch together while another independent session stays unchanged, then checks dropped-action recovery and mobile account access. Workspace memberships/build rows are fixtures; session issuance, switching and reads use actual backend code. No external email provider or production deployment is used.
