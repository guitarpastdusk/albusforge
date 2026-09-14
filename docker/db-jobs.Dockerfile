# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f docker/db-jobs.Dockerfile .
#
# One image for the two Cloud Run jobs that prepare the database before
# gateway deploys (ARCHITECTURE.md §16, M1):
#
#   db-migrate      node packages/db/dist/migrate.js   (as albus_migrate)
#   registry-load   node registry/dist/load.js         (as albus_app)
#
# The entrypoint picks one from its first argument, or from CLOUD_RUN_JOB (the
# job's name, which Cloud Run sets on every task) when there is none, so the
# jobs need no command or args of their own. See docker/db-jobs-entrypoint.sh.

FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Every workspace manifest, and nothing else, as in apps/web/Dockerfile.
FROM base AS manifests
COPY . .
RUN find . -type f ! -name package.json ! -name pnpm-lock.yaml ! -name pnpm-workspace.yaml ! -name .npmrc -delete \
 && find . -mindepth 1 -type d -empty -delete

FROM base AS build
COPY --from=manifests /repo ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter @albusforge/registry... --store-dir /pnpm-store
COPY . .
# The runner is compiled by tsc and imports its dependencies at runtime; the
# loader is one esbuild bundle.
RUN pnpm --filter @albusforge/db build \
 && pnpm --filter @albusforge/registry build

# packages/db's production dependencies only (drizzle-orm, pg, zod), for the runner.
FROM base AS db-deps
COPY --from=manifests /repo ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --prod --filter @albusforge/db --store-dir /pnpm-store

FROM node:22-alpine AS run
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
# pnpm's links are relative, so the tree keeps working under /app.
COPY --from=db-deps /repo/node_modules ./node_modules
COPY --from=db-deps /repo/packages/db/node_modules ./packages/db/node_modules
# package.json files carry "type": "module" for the .js files beside them.
COPY --from=build /repo/packages/db/package.json ./packages/db/
COPY --from=build /repo/packages/db/dist ./packages/db/dist
COPY --from=build /repo/packages/db/migrations ./packages/db/migrations
COPY --from=build /repo/registry/package.json /repo/registry/i2c-shared.json /repo/registry/known-issues.json /repo/registry/compat-matrix.json ./registry/
COPY --from=build /repo/registry/dist ./registry/dist
COPY --from=build /repo/registry/parts ./registry/parts
COPY --from=build /repo/registry/connectors ./registry/connectors
COPY docker/db-jobs-entrypoint.sh /usr/local/bin/db-jobs
USER app
ENTRYPOINT ["/usr/local/bin/db-jobs"]
