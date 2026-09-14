import { DeviceConverseInput, DeviceConverseResponse, routes, type DeviceConverseRequest } from "@albusforge/schema";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { HttpError, parse } from "./http";
import type { AuthHeader } from "./intake";
import { RateLimiter } from "./rate-limit";
import { withSession } from "./session";

export interface DeviceChatClient {
  converse(input: DeviceConverseRequest, signal: AbortSignal): Promise<DeviceConverseResponse>;
}

/** A tool loop can run several model calls, so the body can be larger than the classifier's. */
const MAX_RESPONSE_BYTES = 131072;

export function httpDeviceChatClient(url: string, authHeader: AuthHeader, fetchImpl: typeof fetch = fetch): DeviceChatClient {
  const endpoint = new URL("/v1/converse", url);
  return {
    async converse(input, signal) {
      const authorization = await authHeader();
      signal.throwIfAborted();
      const response = await fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        signal,
        headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const allowed: Record<number, [string, string]> = {
          403: ["FORBIDDEN", "Device access denied"],
          404: ["NOT_FOUND", "Device not found"],
          422: ["TOO_MANY_POINTS", "Ask about a shorter time range"],
          429: ["BUSY", "Device chat is busy; try again shortly"],
        };
        const error = allowed[response.status];
        if (error) throw new HttpError(response.status, error[0], error[1]);
        throw new Error("Device chat unavailable");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty device chat response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_RESPONSE_BYTES) throw new Error("Device chat response too large");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const result = DeviceConverseResponse.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      // The upstream answered some other question if either of these differ.
      if (result.request_id !== input.request_id || result.device_id !== input.device_id) throw new Error("Device chat scope mismatch");
      return result;
    },
  };
}

/** Above the Ask service's own chat deadline, so its deterministic fallback wins the race rather than this timeout. */
export function registerDeviceChat(app: FastifyInstance, pool: Pool, chat: DeviceChatClient | null, timeoutMs = 55000) {
  const limiter = new RateLimiter(20, 60000);
  app.post(routes.devices.chat.pattern, { bodyLimit: 65536 }, async (req, reply) => {
    reply.header("cache-control", "private, no-store");
    const input = await withSession(pool, req.headers.cookie, req.hostname, async (client, tenant, actor) => {
      const { id } = parse(z.strictObject({ id: z.uuid() }), req.params, "device");
      parse(z.strictObject({}), req.query, "query");
      const body = parse(DeviceConverseInput, req.body, "question");
      // Ownership is proven here, against the session's tenant. The identity
      // below is the only scope the tool executors ever see.
      const device = await client.query("SELECT 1 FROM telemetry.devices WHERE id=$1 AND tenant_id=$2", [id, tenant]);
      if (!device.rowCount) throw new HttpError(404, "NOT_FOUND", "Device not found");
      if (limiter.take(actor)) throw new HttpError(429, "BUSY", "Too many questions; try again shortly");
      return { ...body, request_id: req.id, device_id: id, tenant_id: tenant, actor_id: actor };
    });
    if (!chat) throw new HttpError(503, "UNAVAILABLE", "Device chat is not configured");
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const abort = () => controller.abort();
    req.raw.on("aborted", abort);
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Device chat deadline"));
        }, timeoutMs);
      });
      return await Promise.race([chat.converse(input, controller.signal), deadline]);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, "UNAVAILABLE", "Device chat is unavailable; try again shortly");
    } finally {
      clearTimeout(timer);
      req.raw.off("aborted", abort);
      controller.abort();
    }
  });
}
