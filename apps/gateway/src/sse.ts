/*
 * `GET /v1/builds/:id/events`, by polling Postgres (no Redis yet).
 *
 * Event ids are message cursors (chat-store.ts `Cursor`):
 * `<created_at microseconds>.<message uuid>`.
 *
 * Order is fixed: every poll writes `build.updated` (if due) before that
 * poll's `message.created` events, which are oldest first.
 *
 * - The first poll, on connect, always writes `build.updated` with the current
 *   status and spec version, so it is the first event of every stream.
 * - Then every message after `Last-Event-ID` as `message.created`. Without a
 *   (valid) Last-Event-ID, every message is replayed; clients dedupe by id.
 * - Later polls: `build.updated` when (status, spec_version) changed since the
 *   last one sent (intermediate states between two polls are not replayed),
 *   then new messages. A `build.updated` carries the latest cursor sent as its
 *   id, so it never moves a reconnect's position.
 * - A `: ping` comment every heartbeat; the stream ends after maxMs and the
 *   client reconnects with Last-Event-ID.
 *
 * A message committed after a later one was already polled (two writers
 * racing) would sort before the cursor. Each poll therefore re-reads a short
 * lookback window and skips ids this connection already sent. Across a
 * reconnect only messages strictly after the cursor are sent, so a GET of
 * /messages after reconnecting stays the source of truth.
 */
import { BUILD_EVENT, type BuildUpdatedEvent, type ChatMessage, type MessageCreatedEvent } from "@albusforge/schema";
import type { FastifyReply, FastifyRequest } from "fastify";
import { type BuildState, type ChatStore, compareCursors, type Cursor, type MessageRow, parseCursor } from "./chat-store";
import type { Log } from "./log";

export interface SseOptions {
  pollMs: number;
  heartbeatMs: number;
  maxMs: number;
  lookbackMs: number;
}

export const DEFAULT_SSE: SseOptions = { pollMs: 1000, heartbeatMs: 15_000, maxMs: 10 * 60_000, lookbackMs: 5000 };

export function toChatMessage(row: MessageRow): ChatMessage {
  return { id: row.id, role: row.role, text: row.text, created_at: row.createdAt.toISOString(), client_message_id: row.clientMessageId };
}

export interface StreamRegistry {
  /** Ends every open stream (Fastify preClose), so shutdown doesn't wait for maxMs. */
  closeAll(): void;
  add(close: () => void): () => void;
}

export function createStreamRegistry(): StreamRegistry {
  const open = new Set<() => void>();
  return {
    closeAll: () => [...open].forEach((close) => close()),
    add(close) {
      open.add(close);
      return () => open.delete(close);
    },
  };
}

export function streamBuildEvents(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  buildId: string;
  store: ChatStore;
  log: Log;
  options: SseOptions;
  registry: StreamRegistry;
}): void {
  const { request, reply, buildId, store, log, options, registry } = input;
  const lastEventId = request.headers["last-event-id"];
  const resumeFrom = parseCursor(Array.isArray(lastEventId) ? lastEventId[0] : lastEventId);

  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // Stops buffering proxies from holding events back.
    "x-accel-buffering": "no",
  });
  raw.write("retry: 3000\n\n");

  let closed = false;
  let cursor: Cursor | undefined = resumeFrom;
  let lastState: BuildState | undefined;
  const sent = new Map<string, bigint>();
  const timers: NodeJS.Timeout[] = [];

  const close = () => {
    if (closed) return;
    closed = true;
    timers.forEach(clearTimeout);
    unregister();
    raw.end();
  };
  const unregister = registry.add(close);
  request.raw.on("close", close);

  const write = (event: string, data: unknown, id: Cursor | undefined) => {
    if (closed) return;
    const idLine = id ? `id: ${id.micros}.${id.id}\n` : "";
    raw.write(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const poll = async () => {
    const state = await store.buildState(buildId);
    if (!state) return close(); // deleted (expired) under us
    if (!lastState || state.status !== lastState.status || state.specVersion !== lastState.specVersion) {
      const payload: BuildUpdatedEvent = { status: state.status, spec_version: state.specVersion };
      write(BUILD_EVENT.buildUpdated, payload, cursor);
      lastState = state;
    }

    const rows = await store.messagesSince(buildId, cursor, options.lookbackMs);
    for (const row of rows) {
      const position = parseCursor(row.cursor);
      if (!position || sent.has(row.id)) continue;
      if (resumeFrom && compareCursors(position, resumeFrom) <= 0) continue;
      sent.set(row.id, position.micros);
      if (!cursor || compareCursors(position, cursor) > 0) cursor = position;
      const payload: MessageCreatedEvent = { message: toChatMessage(row) };
      write(BUILD_EVENT.messageCreated, payload, position);
    }
    // Forget ids that have left the lookback window.
    if (cursor) {
      const floor = cursor.micros - BigInt(options.lookbackMs) * 2000n;
      for (const [id, micros] of sent) if (micros < floor) sent.delete(id);
    }
  };

  const loop = async () => {
    try {
      await poll();
    } catch (error) {
      log("WARNING", "build events poll failed", { error, trace: request.trace, fields: { requestId: request.id, buildId } });
      return close();
    }
    if (!closed) timers.push(setTimeout(() => void loop(), options.pollMs));
  };

  const heartbeat = () => {
    if (closed) return;
    raw.write(": ping\n\n");
    timers.push(setTimeout(heartbeat, options.heartbeatMs));
  };

  timers.push(setTimeout(heartbeat, options.heartbeatMs));
  timers.push(setTimeout(close, options.maxMs));
  void loop();
}
