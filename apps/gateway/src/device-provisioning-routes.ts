import { DeviceClaimRequest, DeviceHandoffRequest, DeviceReissueRequest, routes } from "@albusforge/schema";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { parse } from "./http";
import { assertSameOrigin } from "./mutation-origin";
import { createDeviceProvisioningStore, type DeviceProvisioningOptions } from "./device-provisioning-store";

export function registerDeviceProvisioning(app: FastifyInstance, pool: Pool, options: DeviceProvisioningOptions) {
  const store = createDeviceProvisioningStore(pool, options);
  const params = z.strictObject({ id: z.uuid() });
  app.register(async scope => {
    scope.addHook("onRequest", async (_request, reply) => { reply.header("cache-control", "private, no-store"); reply.header("x-content-type-options", "nosniff"); });
    scope.get(routes.deviceProvisioning.get.pattern, async request => {
      const { id } = parse(params, request.params, "device id");
      parse(z.strictObject({}), request.query, "query");
      return store.get(request.headers.cookie, request.hostname, id);
    });
    scope.post(routes.deviceProvisioning.claim.path(), async request => {
      assertSameOrigin(request); parse(z.strictObject({}), request.query, "query");
      return store.claim(request.headers.cookie, request.hostname, parse(DeviceClaimRequest, request.body, "claim request"));
    });
    scope.post(routes.deviceProvisioning.download.pattern, async (request, reply) => {
      assertSameOrigin(request); parse(z.strictObject({}), request.query, "query");
      const { id } = parse(params, request.params, "device id");
      const configuration = await store.download(request.headers.cookie, request.hostname, id, parse(DeviceHandoffRequest, request.body, "handoff request"));
      reply.header("content-disposition", 'attachment; filename="device-config.json"');
      return configuration;
    });
    scope.post(routes.deviceProvisioning.reissue.pattern, async request => {
      assertSameOrigin(request); parse(z.strictObject({}), request.query, "query");
      const { id } = parse(params, request.params, "device id");
      return store.reissue(request.headers.cookie, request.hostname, id, parse(DeviceReissueRequest, request.body, "replacement request"));
    });
    scope.post(routes.deviceProvisioning.revoke.pattern, async request => {
      assertSameOrigin(request); parse(z.strictObject({}), request.query, "query");
      const { id } = parse(params, request.params, "device id");
      return store.revoke(request.headers.cookie, request.hostname, id, parse(DeviceHandoffRequest, request.body, "revocation request"));
    });
  });
}
