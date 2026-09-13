# apps/gateway/

The API: Fastify and zod, TypeScript. Deployed as the Cloud Run service `gateway`, which the load balancer sends `/v1` and `/v1/*` to on every host ([ADR 0007](../../docs/adr/0007-portal-routing.md)). Response shapes come from [`@albusforge/schema`](../../packages/schema/), and every response is validated against them on the way out. Data comes from [`@albusforge/db`](../../packages/db/).

M1 is a skeleton: health checks and the parts registry.

## Routes

| Route | Answers |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok"}`. Never touches the database |
| `GET /readyz` | `200` when `SELECT 1` answers within 2 s, otherwise `503` |
| `GET /v1/parts?status=&category=` | `PartList`: the highest SemVer version of each part among versions whose status matches, sorted by id, without blocks |
| `GET /v1/parts/:id?status=` | `PartDetail`: every block of that version, or `404` |
| any other `/v1` path or method | `501 {"error":{"code":"NOT_IMPLEMENTED",…}}` |
| anything else | `404 {"error":{"code":"NOT_FOUND",…}}` |

`status` is comma-separated or repeated (`?status=active,draft`) and defaults to every status except `retired`. The filter applies before "latest": with `?status=active`, a part whose newest version is a draft shows its newest active version. An unknown query parameter, status or category is a `400` with `details`.

Every error, including the 501 and 404, uses the API error shape `{ error: { code, message, details? } }` (ARCHITECTURE.md §6) as JSON, so the portal can tell a gateway answer from an HTML page. A `500` carries only the request id; the error itself goes to the log.

Reads use the registry's SemVer comparator (`@albusforge/registry/semver`), not string order, so `1.10.0` beats `1.9.0` and a release beats its pre-release.

The SSR contract in ADR 0007 (`X-Albus-Internal-Auth` and the forwarded host and client IP) isn't implemented yet: none of these routes depend on the tenant or the client IP. It arrives with the first route that does.

## Run it

```sh
docker compose up -d postgres
# once: migrate and create the app role, then load the registry
DB_HOST=localhost DB_NAME=albus DB_USER=albus_migrate DB_PASSWORD=albus_migrate DB_SSL=disable \
DB_APP_ROLE=albus_app DB_APP_PASSWORD=albus_app pnpm --filter @albusforge/db db:migrate
DB_HOST=localhost DB_NAME=albus DB_USER=albus_app DB_PASSWORD=albus_app DB_SSL=disable \
  pnpm --filter @albusforge/registry load

DB_HOST=localhost DB_NAME=albus DB_USER=albus_app DB_PASSWORD=albus_app DB_SSL=disable \
  pnpm --filter gateway dev          # http://localhost:8080/v1/parts
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Cloud Run sets it |
| `DB_*` | see [packages/db](../../packages/db/README.md#environment) | required at startup, even though `/healthz` doesn't use them, so a misconfigured revision fails to start |
| `GOOGLE_CLOUD_PROJECT` | unset | enables the `logging.googleapis.com/trace` field |

Terraform also sets `PUBLIC_DOMAIN` and `SSR_SERVICE_ACCOUNT`, for the SSR contract; nothing reads them yet.

## Logs

One JSON object per line on stdout, in the shape Cloud Logging parses, with the same conventions as the portal ([`apps/web/src/lib/log.ts`](../web/src/lib/log.ts)): `severity`, `message`, and `logging.googleapis.com/trace` from `X-Cloud-Trace-Context` or `traceparent` when `GOOGLE_CLOUD_PROJECT` is set.

- One `request completed` line per request: `requestId`, `method`, `route` (the pattern), `path` (no query string), `status`, `durationMs`. Successful health checks aren't logged.
- `request failed` at `ERROR` for every 500, with the serialized error.
- Request ids are always generated (UUID) and returned as `X-Request-Id`; an incoming `X-Request-Id` is ignored.
- Never logged: headers, cookies, query values, bodies, `DB_PASSWORD`.

## Shutdown

On `SIGTERM` or `SIGINT` the server stops accepting connections, finishes in-flight requests, closes the database pool and exits. If that takes more than 8 s (Cloud Run allows 10), it exits with status 1.

## Layout

| Path | What it is |
| --- | --- |
| `src/server.ts` | the process: config, pool, listen, signals |
| `src/app.ts` | `buildApp`: hooks, error and not-found handlers, routes |
| `src/parts.ts` | `PartsStore` over `registry.parts`, and `latestPerId` |
| `src/config.ts` | `PORT` and the database env |
| `src/log.ts` | structured logs and trace parsing |
| `Dockerfile` | production image; build from the **repo root** (`docker build -f apps/gateway/Dockerfile .`) |

`pnpm --filter gateway build` bundles `src/server.ts` and its workspace dependencies into `dist/server.js` with esbuild. The workspace packages are TypeScript source, so bundling is simpler than compiling each one, and the image needs no `node_modules`.

## Tests

`pnpm --filter gateway test`. Needs Docker, as for packages/db (see [its README](../../packages/db/README.md#tests) for Colima).

- `app.test.ts`: every route against an in-memory store: health, 501 and 404 fallbacks, query validation, the error shape, and what's logged
- `routes.db.test.ts`: starts `postgres:16-alpine`, migrates with `@albusforge/db`, loads the committed registry with the registry loader as `albus_app`, adds extra versions, and checks SemVer ordering and the status and category filters through the real store
- `parts.test.ts`, `log.test.ts`, `config.test.ts`: unit tests

## Deploy

[`deploy-gateway.yml`](../../.github/workflows/deploy-gateway.yml) runs on pushes to `main` that touch gateway, `packages/`, `registry/` or the images. It builds two images once per commit, `gateway` and `db-jobs` ([`docker/db-jobs.Dockerfile`](../../docker/db-jobs.Dockerfile)), then in staging:

1. updates the `db-migrate` job to the db-jobs digest and executes it, waiting for success
2. does the same for `registry-load`
3. deploys `gateway` by digest
4. tags both digests `staging-deployed-<commit>`, once the scripts confirm what ran

[`promote-gateway.yml`](../../.github/workflows/promote-gateway.yml) promotes both digests to prod in the same order. Both digests must carry the marker from the same staging commit.

The db-jobs entrypoint picks its task from its first argument (`migrate`, `registry-load`) or, with none, from `CLOUD_RUN_JOB`, the name Cloud Run gives every job task. Terraform owns the jobs' command and args and sets neither, so CI can deploy the image without setting anything else (ADR 0005).

ADR 0005's rule applies to gateway and both jobs: don't apply their Terraform while `deploy-gateway` (staging) or `promote-gateway` (prod) might run. Disable that workflow first.
