# cloudlink

Our standalone sensor ingestion service: generic HTTP, shared validation and PostgreSQL transactions. It owns `POST /ingest/v1`; gateway contains no ingest code. No external telemetry application, AI service or broker is on the ingest path.

See [TELEMETRY-INGEST.md](../../docs/TELEMETRY-INGEST.md) for the wire contract, local provisioning/simulator commands, runtime environment, infrastructure handoff, autoscaling budget and production gates.

- `src/app.ts`: process health, request IDs, redacted logs and route registration.
- `src/routes.ts`: bounded admission and atomic ingestion; depends on a generic `pg.Pool`.
- `src/database.ts`: direct PostgreSQL through the shared DB library; private VPC networking and TLS in Cloud Run.
- `src/server.ts`: configuration, startup and graceful shutdown.
- `Dockerfile`: independent non-root Node image; `docker-cloudlink` CI tests the built image with PostgreSQL.

Build: `pnpm --filter cloudlink build`. Test: `pnpm --filter cloudlink test` (Docker required). Local port example: `PORT=8081 pnpm --filter cloudlink dev` so gateway can keep 8080.
