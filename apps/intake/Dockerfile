# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/intake/Dockerfile .
#
# The server is one esbuild bundle (apps/intake/package.json `build`). The
# runtime stage needs Node, that file and the prompt files, and no node_modules.
# dist/server.js reads ../prompts, so the image keeps the app's layout.

FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Every workspace manifest, and nothing else, as in apps/gateway/Dockerfile: the
# install layer below stays cached until a manifest or the lockfile changes.
FROM base AS manifests
COPY . .
RUN find . -type f ! -name package.json ! -name pnpm-lock.yaml ! -name pnpm-workspace.yaml ! -name .npmrc -delete \
 && find . -mindepth 1 -type d -empty -delete

FROM base AS build
COPY --from=manifests /repo ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter intake... --store-dir /pnpm-store
COPY . .
RUN pnpm --filter intake build

FROM node:22-alpine AS run
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/intake/dist/server.js ./dist/server.js
COPY --from=build --chown=app:app /repo/apps/intake/prompts ./prompts
USER app
EXPOSE 8080
# Cloud Run sets PORT; SIGTERM reaches node directly (exec form), which drains and exits.
CMD ["node", "dist/server.js"]
