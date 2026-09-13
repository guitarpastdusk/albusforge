# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/ask/Dockerfile .
#
# The server is one esbuild bundle (apps/ask/package.json `build`), so the
# runtime needs only Node and the bundled server; no node_modules.

FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Every workspace manifest, and nothing else, as in apps/web/Dockerfile: the
# install layer below stays cached until a manifest or the lockfile changes.
FROM base AS manifests
COPY . .
RUN find . -type f ! -name package.json ! -name pnpm-lock.yaml ! -name pnpm-workspace.yaml ! -name .npmrc -delete \
 && find . -mindepth 1 -type d -empty -delete

FROM base AS build
COPY --from=manifests /repo ./
RUN pnpm install --frozen-lockfile --filter ask...
COPY . .
RUN pnpm --filter ask build

FROM node:22-alpine AS run
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/ask/dist/server.js ./server.js
USER app
EXPOSE 8080
# Cloud Run sets PORT; SIGTERM reaches node directly (exec form), which drains and exits.
CMD ["node", "server.js"]
