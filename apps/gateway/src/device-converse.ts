import { DeviceConverseInput, DeviceConverseResponse, routes, type DeviceConverseRequest } from "@albusforge/schema";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { HttpError, parse } from "./http";
import type { AuthHeader } from "./intake";
import { RateLimiter } from "./rate-limit";
import { withPublicTenant, withSession } from "./session";

export interface DeviceChatClient {
  converse(input: DeviceConverseRequest, signal: AbortSignal): Promise<DeviceConverseResponse>;
}

/** A tool loop can run several model calls, so the body can be larger than the classifier's. */
const MAX_RESPONSE_BYTES = 131072;

/** The upstream's own error code, accepted only from a fixed set. Its message is never read. */
const UpstreamCode = z.enum(["DAILY_LIMIT", "BUSY"]);
async function upstreamCode(response: Response): Promise<"DAILY_LIMIT" | "BUSY" | undefined> {
  try {
    const body = await response.text();
    if (body.length > 2048) return undefined;
    const parsed = UpstreamCode.safeParse((JSON.parse(body) as { error?: { code?: unknown } }).error?.code);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

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
        // A spent daily allowance and a momentarily busy service both answer
        // 429, and telling someone to "try again shortly" when they cannot is
        // worse than saying so. Read the upstream code — our own closed
        // vocabulary, never its message — to tell them apart.
        const upstream = response.status === 429 ? await upstreamCode(response) : (await response.body?.cancel(), undefined);
        const allowed: Record<number, [string, string]> = {
          403: ["FORBIDDEN", "Device access denied"],
          404: ["NOT_FOUND", "Device not found"],
          422: ["TOO_MANY_POINTS", "Ask about a shorter time range"],
          429: upstream === "DAILY_LIMIT"
            ? ["DAILY_LIMIT", "You have reached today's limit for device questions."]
            : ["BUSY", "Device chat is busy; try again shortly"],
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

/**
 * The same chat, for a visitor with no session, on the pinned public tenant.
 *
 * Registered only when a tenant is configured, so the endpoint does not exist
 * by default. Three things bound it, and none of them is the others' job:
 * this limiter bounds burst per IP; the Ask service's durable daily ledger
 * bounds spend, with every anonymous turn sharing one allowance; and the turn
 * itself carries no actor, so nothing here can be mistaken for a member.
 *
 * The limiter is in-memory and per-instance (see rate-limit.ts), so it is
 * defence in depth behind Cloud Armor and emphatically not the spend cap.
 */
export function registerPublicDeviceChat(
  app: FastifyInstance,
  pool: Pool,
  chat: DeviceChatClient | null,
  { tenantId, ip, timeoutMs = 55000 }: { tenantId: string; ip: (request: FastifyRequest) => Promise<string> | string; timeoutMs?: number },
) {
  // Tighter than the signed-in limit: a stranger has not been through sign-in,
  // and one visitor should not be able to spend the shared daily allowance.
  const limiter = new RateLimiter(5, 60000);
  app.post(routes.publicLive.converse.pattern, { bodyLimit: 65536 }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    const input = await withPublicTenant(pool, tenantId, async (client, tenant) => {
      const { id } = parse(z.strictObject({ id: z.uuid() }), req.params, "device");
      parse(z.strictObject({}), req.query, "query");
      const body = parse(DeviceConverseInput, req.body, "question");
      // The device must belong to the pinned tenant. `tenant` comes from the
      // configuration this closure was registered with, never from the request.
      const device = await client.query("SELECT 1 FROM telemetry.devices WHERE id=$1 AND tenant_id=$2", [id, tenant]);
      if (!device.rowCount) throw new HttpError(404, "NOT_FOUND", "Device not found");
      // Resolved before the limiter so a forged forwarding header cannot buy a
      // fresh bucket: clientIp only trusts hops it can verify.
      if (limiter.take(await ip(req))) throw new HttpError(429, "BUSY", "Too many questions; try again shortly");
      return { ...body, request_id: req.id, device_id: id, tenant_id: tenant, actor_id: null, public: true };
    });
    return runChatTurn(chat, input, req, timeoutMs);
  });
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
      return { ...body, request_id: req.id, device_id: id, tenant_id: tenant, actor_id: actor, public: false };
    });
    return runChatTurn(chat, input, req, timeoutMs);
  });
}

/**
 * Runs one turn upstream under a deadline, shared by the signed-in and public
 * routes so a failure on the public surface is answered exactly as it is on the
 * private one — deliberately one implementation, as with the read routes.
 */
async function runChatTurn(
  chat: DeviceChatClient | null,
  input: DeviceConverseRequest,
  req: FastifyRequest,
  timeoutMs: number,
) {
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
}
