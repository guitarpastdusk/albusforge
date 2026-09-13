/*
 * The chat routes (M2): create a build from an ask, list and read builds, read
 * and post messages, and stream events. A build is readable by its owner: the
 * tenant of a live `__Host-albus_session`, or, while unclaimed, the
 * `__Host-albus_anon` cookie's hash (PORTAL.md §5). A build the caller doesn't
 * own is a 404, never a 403, so ids can't be probed. Without a session, a new
 * build is anonymous; with one, it belongs to the session's tenant.
 */
import {
  type BuildDetail,
  BuildList,
  type BuildSummary,
  CreateBuildRequest,
  CreatedBuild,
  DisplayStatus,
  MessageList,
  type PartStatus,
  PostMessageRequest,
  PostMessageResponse,
  routes,
} from "@albusforge/schema";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { matchCandidates, specCapabilities } from "./candidates";
import { type BuildRow, type ChatStore, type Owner, ownerKey } from "./chat-store";
import { HttpError, parse } from "./http";
import type { TurnScheduler } from "./intake";
import type { Log } from "./log";
import { anonOwnerSetCookie, anonTokenFromCookieHeader, hashAnonToken, newAnonToken } from "./owner";
import type { PartsStore } from "./parts";
import { RateLimiter } from "./rate-limit";
import { sessionTokenFromCookieHeader } from "./session";
import { createStreamRegistry, DEFAULT_SSE, DEFAULT_STREAM_LIMITS, type SseOptions, type StreamLimits, streamBuildEvents, toChatMessage } from "./sse";

/** Resolves a session cookie's token to its active tenant (auth-store's sessionTenant). */
export interface SessionResolver {
  tenantOf(sessionToken: string): Promise<string | null>;
}

export interface ChatOptions {
  store: ChatStore;
  turns: TurnScheduler;
  /** Left out (tests without sign-in), every request is anonymous and GET /v1/builds is a 401. */
  sessions?: SessionResolver;
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

const BuildsQuery = z.object({ status: DisplayStatus.optional() });

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

  /**
   * Who is asking: the session's tenant when the cookie names a live session
   * (and a resolver is wired), plus the anonymous hash when that cookie is
   * present too. Undefined when the request carries neither credential.
   */
  const ownerOf = async (request: FastifyRequest): Promise<Owner | undefined> => {
    const anonToken = anonTokenFromCookieHeader(request.headers.cookie);
    const sessionToken = chat.sessions === undefined ? undefined : sessionTokenFromCookieHeader(request.headers.cookie);
    const tenantId = sessionToken === undefined ? null : await chat.sessions!.tenantOf(sessionToken);
    const anonHash = anonToken === undefined ? null : hashAnonToken(anonToken);
    return tenantId === null && anonHash === null ? undefined : { tenantId, anonHash };
  };

  /** The caller's build, or a 404 for a missing, malformed or someone else's id. */
  const ownedBuild = async (request: FastifyRequest): Promise<{ build: BuildRow; owner: Owner }> => {
    const { id } = parse(BuildParams, request.params, "build id");
    const owner = await ownerOf(request);
    const build = owner === undefined ? null : await store.findOwnedBuild(id, owner);
    if (!build || owner === undefined) throw notFound(id);
    return { build, owner };
  };

  const summary = (build: BuildRow): BuildSummary => ({
    id: build.id,
    name: nameFromAsk(build.askText),
    description: build.askText,
    // PORTAL.md §4: parts_picked needs a plan for the current spec, which M3 adds.
    display_status: "designing",
    device_count: 0,
    updated_at: build.updatedAt.toISOString(),
  });

  const detail = async (build: BuildRow): Promise<BuildDetail> => {
    const spec = await store.latestSpec(build.id);
    const data = spec && typeof spec.data === "object" && spec.data !== null && !Array.isArray(spec.data) ? (spec.data as Record<string, unknown>) : null;
    const capabilities = specCapabilities(data);
    const candidates = capabilities.length === 0 ? [] : matchCandidates(await parts.latest({ statuses: candidateStatuses }), capabilities);
    return {
      ...summary(build),
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
    // Signed in: the build belongs to the tenant and no anonymous cookie is issued.
    // Otherwise the existing anonymous cookie, or a new one, owns it.
    const tenantId = (await ownerOf(request))?.tenantId ?? null;
    const existingToken = anonTokenFromCookieHeader(request.headers.cookie);
    const token = tenantId !== null ? undefined : (existingToken ?? newAnonToken());
    const owner: Owner = token === undefined ? { tenantId, anonHash: null } : { tenantId: null, anonHash: hashAnonToken(token) };
    const limitKey = ownerKey(owner);

    const result = await store.createBuild({
      owner,
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
        const retryMs = buildLimiter.take(limitKey);
        if (retryMs > 0) throw rateLimited(retryMs, "new builds");
      },
    });

    if (result.kind === "replayed") {
      const built = await detail(result.build);
      return reply.code(200).send(CreatedBuild.parse({ ...built, build_id: built.id, status: result.build.status }));
    }

    const { build } = result;
    if (token !== undefined && existingToken === undefined) reply.header("set-cookie", anonOwnerSetCookie(token));
    turns.trigger(build.id, turnContext(request));

    const built = await detail(build);
    return reply.code(201).send(CreatedBuild.parse({ ...built, build_id: build.id, status: build.status }));
  });

  // The session tenant's builds (PORTAL.md: Projects). Anonymous builds are never listed: they are reached by id.
  app.get(routes.builds.list.pattern, async (request) => {
    const query = parse(BuildsQuery, request.query, "query");
    const owner = await ownerOf(request);
    if (owner?.tenantId === undefined || owner.tenantId === null) throw new HttpError(401, "UNAUTHENTICATED", "Not signed in");
    const rows = (await store.listBuilds(owner.tenantId)).map(summary);
    return BuildList.parse({ builds: query.status === undefined ? rows : rows.filter((row) => row.display_status === query.status) });
  });

  app.get(routes.builds.get.pattern, async (request) => {
    const { build } = await ownedBuild(request);
    await recoverLostTurn(request, build.id);
    return CreatedBuild.omit({ build_id: true }).parse(await detail(build));
  });

  app.get(routes.builds.messages.pattern, async (request) => {
    const { build, owner } = await ownedBuild(request);
    await recoverLostTurn(request, build.id);
    const rows = await store.listMessages(build.id, owner);
    return MessageList.parse({ messages: rows.map(toChatMessage) });
  });

  app.post(routes.builds.postMessage.pattern, async (request, reply) => {
    const { build, owner } = await ownedBuild(request);
    const body = parse(PostMessageBody, request.body, "request body");

    const result = await store.submitUserMessage({
      buildId: build.id,
      owner,
      text: body.text,
      clientMessageId: body.client_message_id,
      pendingWithinS: TURN_IN_PROGRESS_S,
      // Inside the transaction, after the replay and pending checks: neither counts.
      admit: () => {
        const retryMs = messageLimiter.take(ownerKey(owner));
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
    const { build, owner } = await ownedBuild(request);
    const lease = streams.reserve(ownerKey(owner));
    if (!lease) {
      throw new HttpError(429, "RATE_LIMITED", "Too many open event streams; close one or try again later", { retry_after_s: STREAM_RETRY_S }, {
        "retry-after": String(STREAM_RETRY_S),
      });
    }
    try {
      streamBuildEvents({
        request,
        reply,
        buildId: build.id,
        owner,
        // A session can end mid-stream; an anonymous cookie can only lose the build, which buildState catches.
        refreshOwner: owner.tenantId === null ? undefined : () => ownerOf(request),
        store,
        log,
        options: sse,
        lease,
      });
    } catch (error) {
      lease.release();
      throw error;
    }
  });
}
