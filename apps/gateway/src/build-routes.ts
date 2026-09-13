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
import { createStreamRegistry, DEFAULT_SSE, DEFAULT_STREAM_LIMITS, type SseOptions, type StreamLimits, streamBuildEvents, toChatMessage } from "./sse";

export interface ChatOptions {
  store: ChatStore;
  turns: TurnScheduler;
  /** REGISTRY_INCLUDE_DRAFTS: candidate parts come from active and draft parts, not only active. */
  includeDrafts: boolean;
  /**
   * builds and messages are per anonymous owner (defaults: 10 builds an hour,
   * 30 messages in 10 minutes). anonOwners caps, across this whole instance,
   * builds that create a new anonymous owner, meaning no stored build carries
   * the hash yet, whether the cookie was missing or a well-formed but unknown
   * one (ANON_BUILDS_PER_HOUR, default 60). A spend backstop.
   */
  rateLimits?: { builds?: RateLimiter; messages?: RateLimiter; anonOwners?: RateLimiter };
  /** Open event streams (SSE_MAX_STREAMS_PER_OWNER, SSE_MAX_STREAMS). Defaults: 3 per owner, 100 per instance. */
  streamLimits?: StreamLimits;
  sse?: Partial<SseOptions>;
}

/** A newer user message than this with no reply yet means a turn is still running. */
export const TURN_IN_PROGRESS_S = 60;

/** A user message unanswered for longer than this counts as a lost turn; recovery runs at most this often per build. */
export const RECOVERY_INTERVAL_MS = 60_000;

/** Retry-After for a refused event stream. */
const STREAM_RETRY_S = 5;

const ANON_OWNERS_KEY = "instance";

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
  const anonOwnerLimiter = chat.rateLimits?.anonOwners ?? new RateLimiter(60, 60 * 60_000);
  const sse: SseOptions = { ...DEFAULT_SSE, ...chat.sse };
  const streams = createStreamRegistry(chat.streamLimits ?? DEFAULT_STREAM_LIMITS);
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

  /** When the instance-wide cap last logged, so it warns once per window rather than per request. */
  let anonCapWarnedAt = Number.NEGATIVE_INFINITY;

  /**
   * Lost-turn recovery: a read that finds the newest message is a user message
   * unanswered for more than a minute starts a background turn for that stored
   * message (intake reads the transcript; nothing is resent), at most once per
   * build per RECOVERY_INTERVAL_MS on this instance and never while a turn for
   * it is running here. So the portal's "Check for a reply" refetch recovers a
   * lost turn. Intake answers `noop` if the reply was only slow.
   */
  const recoveredAt = new Map<string, number>();
  const recoverLostTurn = async (request: FastifyRequest, buildId: string) => {
    if (turns.isRunning(buildId)) return;
    const now = Date.now();
    const last = recoveredAt.get(buildId);
    if (last !== undefined && now - last < RECOVERY_INTERVAL_MS) return;
    // Claimed before the query, so a burst of concurrent refetches runs one check.
    recoveredAt.set(buildId, now);
    if (recoveredAt.size > 10_000) {
      for (const [id, at] of recoveredAt) if (now - at >= RECOVERY_INTERVAL_MS) recoveredAt.delete(id);
    }
    const newest = await store.lastMessage(buildId, TURN_IN_PROGRESS_S);
    if (!newest || newest.role !== "user" || newest.recent) {
      recoveredAt.delete(buildId); // nothing lost; check again on the next read
      return;
    }
    log("INFO", "recovering an unanswered turn", { trace: request.trace, fields: { requestId: request.id, buildId, messageId: newest.id } });
    turns.trigger(buildId, turnContext(request));
  };

  app.post(routes.builds.create.pattern, async (request, reply) => {
    const body = parse(CreateBuildRequest, request.body, "request body");
    const existingToken = anonTokenFromCookieHeader(request.headers.cookie);
    const token = existingToken ?? newAnonToken();
    const hash = hashAnonToken(token);

    const result = await store.createBuild({
      ownerHash: hash,
      askText: body.ask_text,
      clientMessageId: body.client_message_id ?? null,
      // Runs inside the create transaction, after the replay check: a replay is never limited.
      admit: ({ isNewOwner }) => {
        if (isNewOwner) {
          const capRetryMs = anonOwnerLimiter.take(ANON_OWNERS_KEY);
          if (capRetryMs > 0) {
            const now = anonOwnerLimiter.now();
            if (now - anonCapWarnedAt >= anonOwnerLimiter.windowMs) {
              anonCapWarnedAt = now;
              log("WARNING", "anonymous build cap reached on this instance", {
                trace: request.trace,
                fields: { requestId: request.id, limit: anonOwnerLimiter.limit, windowMs: anonOwnerLimiter.windowMs },
              });
            }
            throw rateLimited(capRetryMs, "new builds");
          }
        }
        const retryMs = buildLimiter.take(hash);
        if (retryMs > 0) throw rateLimited(retryMs, "new builds");
      },
    });

    if (result.kind === "replayed") {
      const built = await detail(result.build);
      return reply.code(200).send(CreatedBuild.parse({ ...built, build_id: built.id, status: result.build.status }));
    }

    const { build } = result;
    if (existingToken === undefined) reply.header("set-cookie", anonOwnerSetCookie(token));
    turns.trigger(build.id, turnContext(request));

    const built = await detail(build);
    return reply.code(201).send(CreatedBuild.parse({ ...built, build_id: build.id, status: build.status }));
  });

  app.get(routes.builds.get.pattern, async (request) => {
    const { build } = await ownedBuild(request);
    await recoverLostTurn(request, build.id);
    return CreatedBuild.omit({ build_id: true }).parse(await detail(build));
  });

  app.get(routes.builds.messages.pattern, async (request) => {
    const { build, hash } = await ownedBuild(request);
    await recoverLostTurn(request, build.id);
    const rows = await store.listMessages(build.id, hash);
    return MessageList.parse({ messages: rows.map(toChatMessage) });
  });

  app.post(routes.builds.postMessage.pattern, async (request, reply) => {
    const { build, hash } = await ownedBuild(request);
    const body = parse(PostMessageBody, request.body, "request body");

    const result = await store.submitUserMessage({
      buildId: build.id,
      ownerHash: hash,
      text: body.text,
      clientMessageId: body.client_message_id,
      pendingWithinS: TURN_IN_PROGRESS_S,
      // Inside the transaction, after the replay and pending checks: neither counts.
      admit: () => {
        const retryMs = messageLimiter.take(hash);
        if (retryMs > 0) throw rateLimited(retryMs, "messages");
      },
    });

    switch (result.kind) {
      case "not_found":
        throw notFound(build.id);
      case "replayed":
        return reply.code(200).send(PostMessageResponse.parse({ message: toChatMessage(result.message) }));
      case "pending":
        throw new HttpError(409, "TURN_IN_PROGRESS", "The previous message is still waiting for a reply; refetch the messages instead of resending", {
          pending_message_id: result.pendingMessageId,
          retry_after_s: TURN_IN_PROGRESS_S,
        });
      case "created":
        turns.trigger(build.id, turnContext(request));
        return reply.code(202).send(PostMessageResponse.parse({ message: toChatMessage(result.message) }));
    }
  });

  app.get(routes.builds.events.pattern, async (request, reply) => {
    const { build, hash } = await ownedBuild(request);
    const lease = streams.reserve(hash);
    if (!lease) {
      throw new HttpError(429, "RATE_LIMITED", "Too many open event streams; close one or try again later", { retry_after_s: STREAM_RETRY_S }, {
        "retry-after": String(STREAM_RETRY_S),
      });
    }
    try {
      streamBuildEvents({ request, reply, buildId: build.id, ownerHash: hash, store, log, options: sse, lease });
    } catch (error) {
      lease.release();
      throw error;
    }
  });
}
