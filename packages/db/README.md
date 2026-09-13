# packages/db/

The Drizzle schema for every service, the SQL migrations generated from it, the migration runner, and the client factory. `packages/db` owns every migration ([`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §3). Services never migrate, and they never run raw SQL; they import tables and `createDb` from here.

Services consume it as TypeScript source (`exports` points at `src/index.ts`). Only the migration runner is compiled, to `dist/`, so the migrate Job runs it with plain `node`.

| Path | What it is |
| --- | --- |
| `src/schema/users.ts` | `users` schema: users, tenants, tenant_members, sessions, email_codes ([ADR 0008](../../docs/adr/0008-sign-in-by-email-code.md), [ADR 0009](../../docs/adr/0009-tenant-created-at-sign-up.md)) |
| `src/schema/registry.ts` | `registry` schema: parts, compat_matrix |
| `src/schema/builds.ts` | `builds` schema: builds, build_messages, specs, plans, code_bundles, bodies, llm_calls |
| `src/client.ts` | `createDb(config)` returns `{ db, pool }`, a typed Drizzle instance over a `pg` pool. `createClientDb(client)` returns `{ db, close }` over one checked-out connection, for work holding a session resource (an advisory lock) that must not take a second connection; `close()` fences the handle before the connection is released |
| `src/config.ts` | `dbConfigFromEnv()` and `appRoleFromEnv()` |
| `src/migrate.ts` | the migration runner |
| `migrations/` | generated SQL plus drizzle-kit's snapshots. Commit both, and never edit them by hand |

`orders`, `market` and `cloud` (§5) arrive with the milestones that use them.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `DB_HOST` | required | Cloud SQL private IP, or `localhost` |
| `DB_PORT` | `5432` | |
| `DB_NAME` | required | |
| `DB_USER` | required | `albus_migrate` for the runner, `albus_app` for services |
| `DB_PASSWORD` | required | |
| `DB_SSL` | `require` | `require`: TLS on, no CA verification. Cloud SQL private IP enforces `ENCRYPTED_ONLY`. `disable`: plain TCP, for local Postgres |
| `DB_APP_ROLE` | unset | Runner only. The role services connect as. Set it together with `DB_APP_PASSWORD` |
| `DB_APP_PASSWORD` | unset | Runner only. That role's password, applied on every run. Never logged |

## Role model

| Role | Created by | Can |
| --- | --- | --- |
| `albus_migrate` | Terraform | Own every schema and table. It runs migrations, and only in the pre-deploy Job |
| `albus_app` | the runner | `SELECT`, `INSERT`, `UPDATE`, `DELETE` on app tables, and `USAGE` on schemas and sequences. No DDL |

Terraform doesn't create `albus_app`. Cloud SQL puts every user created through its API into `cloudsqlsuperuser`, which carries `CREATE` on the database, so an API-created app user could run DDL. When `DB_APP_ROLE` and `DB_APP_PASSWORD` are both set, the runner does this after migrating, in one transaction:

1. `CREATE ROLE … LOGIN NOINHERIT PASSWORD …` if the role is missing, or `ALTER ROLE … WITH LOGIN NOINHERIT PASSWORD …` if it exists. That also covers password rotation.
2. Revokes every role membership the app role holds, one `REVOKE … GRANTED BY <grantor>` per grant. NOINHERIT isn't enough on its own: a SET-only membership still allows `SET ROLE`. If a grant remains that the migrator can't revoke as its grantor, the run fails closed (step 5).
3. `REVOKE CREATE ON DATABASE <db> FROM PUBLIC` and `REVOKE CREATE ON SCHEMA public FROM PUBLIC`.
4. For each schema in `APP_SCHEMAS`, grants the privileges in the table above, with `ALTER DEFAULT PRIVILEGES` so tables from later migrations are covered too.
5. Checks that the role has no memberships left, no superuser, `CREATEDB` or `CREATEROLE` attribute, and no `CREATE` on the database, `public` or any app schema. If any check fails, the transaction rolls back, the runner sets the role `NOLOGIN`, and the Job fails. Connections already open stay open. The next clean run restores `LOGIN`.

## Commands

```sh
pnpm --filter @albusforge/db db:generate   # after editing src/schema: writes a new migration
pnpm --filter @albusforge/db lint          # eslint, then fails if migrations/ is behind src/schema
pnpm --filter @albusforge/db typecheck
pnpm --filter @albusforge/db test          # needs Docker
pnpm --filter @albusforge/db build         # compiles dist/ for the runner
```

`db:generate` asks drizzle-kit for a name on renames; answer it, then check the SQL before committing.

### Running migrations

The migrate Cloud Run Job runs the compiled runner from the repo root. It needs `packages/db/dist`, `packages/db/migrations` and the package's production dependencies:

```sh
node packages/db/dist/migrate.js
```

It takes a Postgres advisory lock first, so two runs started together queue, and the second finds nothing to do. It logs JSON lines for Cloud Logging, and exits non-zero on any failure.

Locally:

```sh
docker compose up -d postgres
DB_HOST=localhost DB_NAME=albus DB_USER=albus_migrate DB_PASSWORD=albus_migrate DB_SSL=disable \
DB_APP_ROLE=albus_app DB_APP_PASSWORD=albus_app \
  pnpm --filter @albusforge/db db:migrate
```

Locally, the compose superuser stands in for `albus_migrate`.

## Tests

`src/migrate.test.ts` starts `postgres:16-alpine` with testcontainers and checks that:

- migrations apply to an empty database
- a second run is a no-op
- two concurrent runs both succeed
- `builds_owner_check` rejects a build with no owner
- `client_message_id` is unique per build
- `llm_calls` rows survive deleting their build
- the app role can log in, can read and write, and cannot create a table in any app schema or `public`, create a schema, or drop a table
- a SET-only membership in a role with `CREATE` on an app schema is revoked when the migrator can revoke it as the grantor. When it can't, the run fails and the role can no longer log in. Either way, `SET ROLE` plus `CREATE TABLE` fails afterwards

Docker has to be running. With Colima, point testcontainers at its socket:

```sh
DOCKER_HOST=unix://$HOME/.colima/default/docker.sock \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
  pnpm --filter @albusforge/db test
```

## Telemetry foundation

Migration `0001_telemetry_ingest.sql` adds the `telemetry` schema: device identities and channel snapshots, retry receipts, raw readings, latest samples and monthly usage. The app-role grant list includes the schema. These are ordinary development tables; partitioning and retention jobs remain M6b work. See [the ingestion runbook](../../docs/TELEMETRY-INGEST.md) for the atomic write contract and replay semantics.
