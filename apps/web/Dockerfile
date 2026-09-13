# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/web/Dockerfile .

FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# Every workspace manifest, and nothing else. pnpm refuses to run once
# `COPY . .` brings in a workspace package the install didn't see, so listing
# packages one by one breaks each time one is added. This stage reruns on any
# change, but its output only changes with a manifest, so the install layer
# below stays cached.
FROM base AS manifests
COPY . .
RUN find . -type f ! -name package.json ! -name pnpm-lock.yaml ! -name pnpm-workspace.yaml ! -name .npmrc -delete \
 && find . -mindepth 1 -type d -empty -delete

FROM base AS build
COPY --from=manifests /repo ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter web... --store-dir /pnpm-store
COPY . .
RUN pnpm --filter web build

FROM node:22-alpine AS run
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
# Standalone output traced from the repo root, so server.js sits at apps/web/.
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 8080
# Cloud Run sets PORT; the standalone server reads it.
CMD ["node", "apps/web/server.js"]
