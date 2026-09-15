# syntax=docker/dockerfile:1
# Build from repository root. Both executable and isolated ADC worker are bundled.
FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter observation-maintain...
RUN pnpm --filter @albusforge/storage build
RUN pnpm --filter observation-maintain build
FROM node:22-alpine AS run
ENV NODE_ENV=production OBSERVATION_STORAGE_WORKER_PATH=/app/storage-worker.cjs
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/observation-maintain/dist/server.js ./server.js
COPY --from=build --chown=app:app /repo/packages/storage/dist/storage-worker.cjs ./storage-worker.cjs
USER app
CMD ["node", "server.js"]
