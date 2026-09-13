/*
 * The anonymous chat routes (M2): create a build from an ask, read it, read
 * and post messages, and stream events. Every build route is authorized by the
 * `__Host-albus_anon` cookie's hash; a build the caller doesn't own is a 404,
 * never a 403, so ids can't be probed. Claimed (tenant) builds and sessions
 * arrive with sign-in.
 */
import {
  type BuildDetail,
  CreateBuildRequest,
  CreatedBuild,
  MessageList,
  type PartStatus,
  PostMessageRequest,
  PostMessageResponse,
  routes,
} from "@albusforge/schema";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { matchCandidates, specCapabilities } from "./candidates";
import type { BuildRow, ChatStore } from "./chat-store";
import { HttpError, parse } from "./http";
import type { TurnScheduler } from "./intake";
import type { Log } from "./log";
import { anonOwnerSetCookie, anonTokenFromCookieHeader, hashAnonToken, newAnonToken } from "./owner";
import type { PartsStore } from "./parts";
import { RateLimiter } from "./rate-limit";
import { createStreamRegistry, DEFAULT_SSE, type SseOptions, streamBuildEvents, toChatMessage } from "./sse";

export interface ChatOptions {
  store: ChatStore;
  turns: TurnScheduler;
  /** REGISTRY_INCLUDE_DRAFTS: candidate parts come from active and draft parts, not only active. */
  includeDrafts: boolean;
  /** Per anonymous owner. Defaults: 10 builds an hour, 30 messages in 10 minutes. */
  rateLimits?: { builds?: RateLimiter; messages?: RateLimiter };
  sse?: Partial<SseOptions>;
}

/** A newer user message than this with no reply yet means a turn is still running. */
export const TURN_IN_PROGRESS_S = 60;

const BuildParams = z.object({ id: z.string().min(1).max(100) });

/** `client_message_id` is required here; the shared schema relaxes it only until the portal sends it. */
const PostMessageBody = PostMessageRequest.extend({ client_message_id: z.uuid() });

const NAME_LENGTH = 60;

/** Until a spec names the device: the ask's first line, shortened. */
function nameFromAsk(askText: string): string {
  const line = askText.trim().split("\n", 1)[0]!.trim();
  return line.length <= NAME_LENGTH ? line : `${line.slice(0, NAME_LENGTH - 1).trimEnd()}…`;
}

const notFound = (id: string) => new HttpError(404, "NOT_FOUND", `No build ${id}`);

function rateLimited(retryMs: number, what: string): HttpError {
  const retryAfterS = Math.max(1, Math.ceil(retryMs / 1000));
  return new HttpError(429, "RATE_LIMITED", `Too many ${what}; try again later`, { retry_after_s: retryAfterS }, { "retry-after": String(retryAfterS) });
}

export function registerBuildRoutes(app: FastifyInstance, { parts, log, chat }: { parts: PartsStore; log: Log; chat: ChatOptions }): void {
  const { store, turns, includeDrafts } = chat;
  const buildLimiter = chat.rateLimits?.builds ?? new RateLimiter(10, 60 * 60_000);
  const messageLimiter = chat.rateLimits?.messages ?? new RateLimiter(30, 10 * 60_000);
  const sse: SseOptions = { ...DEFAULT_SSE, ...chat.sse };
  const streams = createStreamRegistry();
  const candidateStatuses: PartStatus[] = includeDrafts ? ["active", "draft"] : ["active"];

  app.addHook("preClose", async () => streams.closeAll());

  const ownerHash = (request: FastifyRequest): string | undefined => {
    const token = anonTokenFromCookieHeader(request.headers.cookie);
    return token === undefined ? undefined : hashAnonToken(token);
  };

  /** The caller's build, or a 404 for a missing, malformed, claimed or someone else's id. */
  const ownedBuild = async (request: FastifyRequest): Promise<{ build: BuildRow; hash: string }> => {
    const { id } = parse(BuildParams, request.params, "build id");
    const hash = ownerHash(request);
    const build = hash === undefined ? null : await store.findOwnedBuild(id, hash);
    if (!build || hash === undefined) throw notFound(id);
    return { build, hash };
  };

  const detail = async (build: BuildRow): Promise<BuildDetail> => {
    const spec = await store.latestSpec(build.id);
    const data = spec && typeof spec.data === "object" && spec.data !== null && !Array.isArray(spec.data) ? (spec.data as Record<string, unknown>) : null;
    const capabilities = specCapabilities(data);
    const candidates = capabilities.length === 0 ? [] : matchCandidates(await parts.latest({ statuses: candidateStatuses }), capabilities);
    return {
      id: build.id,
      name: nameFromAsk(build.askText),
      description: build.askText,
      // PORTAL.md §4: parts_picked needs a plan for the current spec, which M3 adds.
      display_status: "designing",
      device_count: 0,
      updated_at: build.updatedAt.toISOString(),
      ready: null,
      status: build.status,
      spec_version: spec?.version ?? null,
      spec: data,
      candidate_parts: candidates,
    };
  };

  const turnContext = (request: FastifyRequest) => ({ trace: request.trace, requestId: request.id });

  app.post(routes.builds.create.pattern, async (request, reply) => {
    const body = parse(CreateBuildRequest, request.body, "request body");
    const existingToken = anonTokenFromCookieHeader(request.headers.cookie);
    const token = existingToken ?? newAnonToken();
    const hash = hashAnonToken(token);

    if (existingToken !== undefined && body.client_message_id !== undefined) {
      const replayed = await store.findBuildByFirstMessage(hash, body.client_message_id);
      if (replayed) {
        const built = await detail(replayed);
        return reply.code(200).send(CreatedBuild.parse({ ...built, build_id: built.id, status: replayed.status }));
      }
    }

    const retryMs = buildLimiter.take(hash);
    if (retryMs > 0) throw rateLimited(retryMs, "new builds");

    const { build } = await store.createBuild({ ownerHash: hash, askText: body.ask_text, clientMessageId: body.client_message_id ?? null });
    if (existingToken === undefined) reply.header("set-cookie", anonOwnerSetCookie(token));
    turns.trigger(build.id, turnContext(request));

    const built = await detail(build);
    return reply.code(201).send(CreatedBuild.parse({ ...built, build_id: build.id, status: build.status }));
  });

  app.get(routes.builds.get.pattern, async (request) => {
    const { build } = await ownedBuild(request);
    return CreatedBuild.omit({ build_id: true }).parse(await detail(build));
  });

  app.get(routes.builds.messages.pattern, async (request) => {
    const { build } = await ownedBuild(request);
    const rows = await store.listMessages(build.id);
    return MessageList.parse({ messages: rows.map(toChatMessage) });
  });

  app.post(routes.builds.postMessage.pattern, async (request, reply) => {
    const { build, hash } = await ownedBuild(request);
    const body = parse(PostMessageBody, request.body, "request body");

    const replayed = await store.findMessageByClientId(build.id, body.client_message_id);
    if (replayed) return reply.code(200).send(PostMessageResponse.parse({ message: toChatMessage(replayed) }));

    const retryMs = messageLimiter.take(hash);
    if (retryMs > 0) throw rateLimited(retryMs, "messages");

    const last = await store.lastMessage(build.id, TURN_IN_PROGRESS_S);
    if (last && last.role === "user" && last.recent) {
      throw new HttpError(409, "TURN_IN_PROGRESS", "The previous message hasn't been answered yet", {
        pending_message_id: last.id,
        retry_after_s: TURN_IN_PROGRESS_S,
      });
    }

    const { message, created } = await store.insertUserMessage(build.id, body.text, body.client_message_id);
    // Lost a race with the same client_message_id: the other request started the turn.
    if (!created) return reply.code(200).send(PostMessageResponse.parse({ message: toChatMessage(message) }));

    turns.trigger(build.id, turnContext(request));
    return reply.code(202).send(PostMessageResponse.parse({ message: toChatMessage(message) }));
  });

  app.get(routes.builds.events.pattern, async (request, reply) => {
    const { build } = await ownedBuild(request);
    streamBuildEvents({ request, reply, buildId: build.id, store, log, options: sse, registry: streams });
  });
}
