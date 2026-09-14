# syntax=docker/dockerfile:1
# Dedicated fwbuild job. Compiler never runs inside the gateway service.
FROM node:22-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @albusforge/codegen... --store-dir /pnpm-store
RUN pnpm --filter @albusforge/codegen build

# Resolve only at image-build time. IDF validates component hashes from the
# committed lock; refusing lock changes prevents a silent dependency upgrade.
FROM espressif/idf@sha256:8ccd4d2ce413889c6c2bba57e986c670302094efb91c913c6091152e317a7805 AS camera-components
SHELL ["/bin/bash", "-c"]
WORKDIR /camera
COPY firmware/esp32s3-camera ./
RUN cp dependencies.lock /tmp/camera-dependencies.lock && \
    . /opt/esp/idf/export.sh && idf.py -B /tmp/camera-prepare reconfigure && \
    cmp dependencies.lock /tmp/camera-dependencies.lock && \
    rm -rf /tmp/camera-prepare sdkconfig sdkconfig.old

FROM espressif/idf@sha256:8ccd4d2ce413889c6c2bba57e986c670302094efb91c913c6091152e317a7805 AS run
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /repo/apps/codegen/dist/job.js ./job.js
COPY firmware ./firmware
COPY --from=camera-components /camera/managed_components ./firmware/esp32s3-camera/managed_components
ENV NODE_ENV=production FIRMWARE_COMPILER_MODE=idf FIRMWARE_TEMPLATE_DIR=/app/firmware/esp32s3 FIRMWARE_CAMERA_TEMPLATE_DIR=/app/firmware/esp32s3-camera
# Espressif's inherited entrypoint activates the pinned Python/IDF toolchain.
CMD ["node", "/app/job.js"]
