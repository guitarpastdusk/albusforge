/*
 * `GET /v1/builds/:id/events`, by polling Postgres (no Redis yet).
 *
 * Event ids are message cursors (chat-store.ts `Cursor`):
 * `<created_at microseconds>.<message uuid>`.
 *
 * Order: every poll writes `build.updated` (if due) before that poll's
 * `message.created` events, which are oldest first.
 *
 * - The first poll, on connect, always writes `build.updated` with the current
 *   status and spec version, so it is the first event of every stream.
 * - Then every message after `Last-Event-ID` as `message.created`. Without a
 *   (valid) Last-Event-ID, every message is replayed; clients dedupe by id.
 * - Later polls: `build.updated` when (status, spec_version) changed since the
 *   last one sent (intermediate states between two polls are not replayed),
 *   then new messages. Clients must not assume an order between a status
 *   change and a message written independently. A `build.updated` carries the
 *   latest cursor sent as its id, so it never moves a reconnect's position.
 * - A `: ping` comment every heartbeat; the stream ends after maxMs and the
 *   client reconnects with Last-Event-ID.
 *
 * Every poll resolves credentials, build ownership and messages in one short
 * repeatable-read snapshot, committed before emitting any event. A previously
 * admitted batch may finish; later data cannot use its earlier authorization.
 * The next poll observes revocation, expiry, membership removal or a claim.
 *
 * Admission is bounded per owner and per instance (StreamRegistry). A client
 * that stops reading is dropped: polling pauses while a write is still
 * buffered, and the stream is destroyed when the wait passes drainTimeoutMs or
 * the unsent buffer passes maxBufferedBytes. A reader that drains before the
 * next poll is never waited on: the `drain` listener goes on at the moment the
 * write buffers, and the next tick checks `writableNeedDrain` rather than a
 * latched flag.
 *
 * A message committed after a later one was already polled (two writers
 * racing) would sort before the cursor. Each poll therefore re-reads a short
 * lookback window and skips ids this connection already sent. Across a
 * reconnect only messages strictly after the cursor are sent, so a GET of
 * /messages after reconnecting stays the source of truth.
 */
import { BUILD_EVENT, type BuildUpdatedEvent, type ChatMessage, type MessageCreatedEvent } from "@albusforge/schema";
import type { FastifyReply, FastifyRequest } from "fastify";
import { type BuildState, type ChatStore, compareCursors, type Cursor, type MessageRow, type StreamCredentials, parseCursor } from "./chat-store";
import { describeError } from "./db-log";
import type { Log } from "./log";

export interface SseOptions {
  pollMs: number;
  heartbeatMs: number;
  maxMs: number;
  lookbackMs: number;
  /** Unsent bytes buffered for one client before it is dropped. */
  maxBufferedBytes: number;
  /** How long a client may leave a write undrained before it is dropped. */
  drainTimeoutMs: number;
}

export const DEFAULT_SSE: SseOptions = {
  pollMs: 1000,
  heartbeatMs: 15_000,
  maxMs: 10 * 60_000,
  lookbackMs: 5000,
  maxBufferedBytes: 1024 * 1024,
  drainTimeoutMs: 30_000,
};

export interface StreamLimits {
  perOwner: number;
  perInstance: number;
}

export const DEFAULT_STREAM_LIMITS: StreamLimits = { perOwner: 3, perInstance: 100 };

export function toChatMessage(row: MessageRow): ChatMessage {
  return { id: row.id, role: row.role, text: row.text, created_at: row.createdAt.toISOString(), client_message_id: row.clientMessageId };
}

/** One admitted stream. Released exactly once, however the stream ends. */
export interface StreamLease {
  /** Registers how to end this stream from closeAll. */
  onClose(close: () => void): void;
  release(): void;
}

export interface StreamRegistry {
  /** A lease for this owner key (chat-store's ownerKey), or null when the owner or the instance is at its limit. */
  reserve(ownerKey: string): StreamLease | null;
  /** Ends every open stream (Fastify preClose), so shutdown doesn't wait for maxMs. */
  closeAll(): void;
  readonly size: number;
}

export function createStreamRegistry(limits: StreamLimits = DEFAULT_STREAM_LIMITS): StreamRegistry {
  const perOwner = new Map<string, number>();
  const closers = new Set<() => void>();
  let total = 0;
  return {
    get size() {
      return total;
    },
    reserve(ownerHash) {
      const owned = perOwner.get(ownerHash) ?? 0;
      if (owned >= limits.perOwner || total >= limits.perInstance) return null;
      perOwner.set(ownerHash, owned + 1);
      total++;
      let released = false;
      let closer: (() => void) | undefined;
      return {
        onClose(close) {
          closer = close;
          closers.add(close);
        },
        release() {
          if (released) return;
          released = true;
          total--;
          const left = (perOwner.get(ownerHash) ?? 1) - 1;
          if (left <= 0) perOwner.delete(ownerHash);
          else perOwner.set(ownerHash, left);
          if (closer) closers.delete(closer);
        },
      };
    },
    closeAll() {
      [...closers].forEach((close) => close());
    },
  };
}

export function streamBuildEvents(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  buildId: string;
  credentials: StreamCredentials;
  store: ChatStore;
  log: Log;
  options: SseOptions;
  lease: StreamLease;
}): void {
  const { request, reply, buildId, credentials, store, log, options, lease } = input;
  const lastEventId = request.headers["last-event-id"];
  const resumeFrom = parseCursor(Array.isArray(lastEventId) ? lastEventId[0] : lastEventId);
  const logFields = { requestId: request.id, buildId };

  reply.hijack();
  const raw = reply.raw;

  let closed = false;
  /** Set the moment a write is buffered, never a tick later: see awaitDrain. */
  let drainWait: { settled: Promise<"drained" | "timeout">; cancel: () => void } | null = null;
  let cursor: Cursor | undefined = resumeFrom;
  let lastState: BuildState | undefined;
  const sent = new Map<string, bigint>();
  let pollTimer: NodeJS.Timeout | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  const maxTimer: NodeJS.Timeout = setTimeout(() => close(), options.maxMs);

  const close = (how: "end" | "destroy" = "end") => {
    if (closed) return;
    closed = true;
    clearTimeout(pollTimer);
    clearTimeout(heartbeatTimer);
    clearTimeout(maxTimer);
    // Clears the drain timer and listener, so no waiter outlives the stream.
    drainWait?.cancel();
    drainWait = null;
    lease.release();
    if (how === "destroy") raw.destroy();
    else raw.end();
  };
  lease.onClose(() => close());
  request.raw.on("close", () => close());
  raw.on("close", () => close());

  const dropSlowClient = (reason: string) => {
    log("INFO", "closing slow event stream", { trace: request.trace, fields: { ...logFields, reason, bufferedBytes: raw.writableLength } });
    close("destroy");
  };

  /**
   * Listens for `drain` straight away, because a healthy reader can drain
   * before the next poll tick. Waiting until then would miss the event and
   * then time out a connection that is perfectly fine.
   */
  const awaitDrain = () => {
    let settle!: (result: "drained" | "timeout") => void;
    const settled = new Promise<"drained" | "timeout">((resolve) => (settle = resolve));
    const cleanUp = () => {
      clearTimeout(timer);
      raw.off("drain", onDrain);
    };
    const onDrain = () => {
      cleanUp();
      settle("drained");
    };
    const timer = setTimeout(() => {
      cleanUp();
      settle("timeout");
    }, options.drainTimeoutMs);
    raw.once("drain", onDrain);
    return {
      settled,
      cancel: () => {
        cleanUp();
        settle("drained");
      },
    };
  };

  const send = (chunk: string) => {
    if (closed) return;
    // write() false means this chunk is buffered: start waiting for drain now.
    if (!raw.write(chunk)) drainWait ??= awaitDrain();
    if (raw.writableLength > options.maxBufferedBytes) dropSlowClient("buffer");
  };

  raw.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // Stops buffering proxies from holding events back.
    "x-accel-buffering": "no",
  });
  send("retry: 3000\n\n");

  const event = (name: string, data: unknown, id: Cursor | undefined) => {
    const idLine = id ? `id: ${id.micros}.${id.id}\n` : "";
    send(`${idLine}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const poll = async () => {
    // Fetch everything under one authorized snapshot; release its transaction
    // before emitting events or waiting for socket backpressure.
    const batch = await store.readEventBatch(buildId, credentials, cursor, options.lookbackMs);
    if (!batch) return close();
    const { state, messages: rows } = batch;
    if (!lastState || state.status !== lastState.status || state.specVersion !== lastState.specVersion) {
      const payload: BuildUpdatedEvent = { status: state.status, spec_version: state.specVersion };
      event(BUILD_EVENT.buildUpdated, payload, cursor);
      lastState = state;
    }

    for (const row of rows) {
      if (closed) return;
      const position = parseCursor(row.cursor);
      if (!position || sent.has(row.id)) continue;
      if (resumeFrom && compareCursors(position, resumeFrom) <= 0) continue;
      sent.set(row.id, position.micros);
      if (!cursor || compareCursors(position, cursor) > 0) cursor = position;
      const payload: MessageCreatedEvent = { message: toChatMessage(row) };
      event(BUILD_EVENT.messageCreated, payload, position);
    }
    // Forget ids that have left the lookback window.
    if (cursor) {
      const floor = cursor.micros - BigInt(options.lookbackMs) * 2000n;
      for (const [id, micros] of sent) if (micros < floor) sent.delete(id);
    }
  };

  const loop = async () => {
    if (closed) return;
    if (drainWait) {
      // The socket may have drained already, in which case the waiter has
      // resolved (or is moot) and nothing should wait for a second drain.
      if (!raw.writableNeedDrain) {
        drainWait.cancel();
        drainWait = null;
      } else {
        const result = await drainWait.settled;
        drainWait = null;
        if (closed) return;
        if (result === "timeout") return dropSlowClient("drain timeout");
      }
    }
    try {
      await poll();
    } catch (error) {
      log("WARNING", "build events poll failed", { ...describeError(error), trace: request.trace, fields: logFields });
      return close();
    }
    if (!closed) pollTimer = setTimeout(() => void loop(), options.pollMs);
  };

  const heartbeat = () => {
    if (closed) return;
    if (!raw.writableNeedDrain) send(": ping\n\n");
    heartbeatTimer = setTimeout(heartbeat, options.heartbeatMs);
  };

  heartbeatTimer = setTimeout(heartbeat, options.heartbeatMs);
  void loop();
}
