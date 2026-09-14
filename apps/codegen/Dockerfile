# syntax=docker/dockerfile:1
# Dedicated fwbuild job. Compiler never runs inside the gateway service.
FROM node:22-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @albusforge/codegen... --store-dir /pnpm-store
RUN pnpm --filter @albusforge/codegen build

FROM espressif/idf@sha256:8ccd4d2ce413889c6c2bba57e986c670302094efb91c913c6091152e317a7805 AS run
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /repo/apps/codegen/dist/job.js ./job.js
COPY firmware ./firmware
ENV NODE_ENV=production FIRMWARE_COMPILER_MODE=idf FIRMWARE_TEMPLATE_DIR=/app/firmware/esp32s3
# Espressif's inherited entrypoint activates the pinned Python/IDF toolchain.
CMD ["node", "/app/job.js"]
