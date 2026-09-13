# Build event authorization and read snapshots

`GET /v1/builds/:id/events` polls PostgreSQL. Each poll must read data from the same snapshot that authorizes it. Previously it resolved a session, read the build, emitted `build.updated`, then queried messages using the cached tenant identity. Sign-out could commit between these operations; a subsequent message could be returned despite being created after that sign-out.

## Implemented boundary

`ChatStore.readEventBatch` uses one short `REPEATABLE READ READ ONLY` transaction to resolve a supplied session token against current session validity and tenant membership, check build ownership (including an anonymous credential for an unclaimed build), and fetch build state and messages. The shared `sessionTenantIn` resolver accepts a query context so its snapshot is the same as the data queries. Session expiry uses statement time at authorization, rather than transaction start.

The transaction commits before the poll emits `build.updated` or `message.created`. Heartbeats, socket buffering, drain waits and the next poll timer never retain it. The gateway's existing database statement/query timeouts bound database waits; a failed poll closes the stream through its existing error handling. No service, pool, migration or deployment change is needed.

`readSnapshot` explicitly owns the checked-out PostgreSQL client, including transaction startup. It attaches an active-client error listener before resolving checkout; the pool's idle error listener does not cover this phase. On success it commits, fences the scoped database handle, and performs bounded rollback cleanup (at most one second) to verify reusable protocol state. It releases the client before removing its active listener, so the pool's idle listener already covers the connection. Failed BEGIN/read/COMMIT or cleanup, and any connection error, destroy the uncertain client instead of returning it to the pool. Destruction rolls back any remaining server transaction; the active error absorber remains through termination, including late socket errors. No additional rollback is queued behind an already timed-out response.

Access loss committed before the snapshot prevents admission. Access loss committed afterward does not invalidate the already admitted snapshot: that batch can finish, including messages that existed at admission. Messages committed after admission cannot be included. The next poll re-resolves credentials and sees revocation, expiry, membership removal, or a changed build owner. This is admitted-read semantics, not a guarantee that bytes already admitted or written can be recalled after sign-out.

Existing credential behavior is preserved: an anonymous cookie can authorize only an unclaimed build; a session uses its active tenant and current membership. Session-family sign-out updates the family in the auth store. This change does not introduce subdomain session handoff, additional session issuance, or a new identity provider.

## Regression evidence

Real PostgreSQL tests use an exclusive `builds.specs` lock to stop a real HTTP stream's poll after the authorization snapshot has been established but before its message query. PostgreSQL's blocking graph confirms the interleaving; no arbitrary wait is used to decide when to revoke. The tests then commit sign-out, expiry, or membership removal and insert a new private message before releasing the lock. The admitted earlier message arrives, the newer message does not, and the next poll closes. Tests also verify no idle transaction remains. Real PostgreSQL failure tests also pause socket reads at BEGIN, COMMIT and cleanup ROLLBACK, and destroy a checked-out socket while a real stream waits on the database. Each failure closes/rejects the poll, releases capacity without manual lease recovery, and permits a fresh query/batch using a one-connection pool. The test runner retains its uncaught-error detection. Existing anonymous claim/reownership, resume, backpressure, access-loss and auth tests remain applicable.

The fix was prompted by the unchanged gateway auth test failing during public-page PR #48 CI. It is isolated from that page change in its own PR.
