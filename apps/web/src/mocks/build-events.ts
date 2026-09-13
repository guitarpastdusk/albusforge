import { BUILD_EVENT, type BuildUpdatedEvent, type MessageCreatedEvent } from "@albusforge/schema";
import * as data from "./data";

/** How often the mock stream looks for new messages and status changes. */
const POLL_MS = process.env.NODE_ENV === "test" ? 10 : 250;
const PING_MS = 15_000;

/**
 * Mock mode's GET /v1/builds/:id/events, shaped like gateway's stream: on
 * connect, `build.updated` and the whole transcript as `message.created` (no
 * Last-Event-ID resume here), then each new message and every status or spec
 * change, with `: ping` comments. Ends when the client disconnects.
 */
export function mockBuildEvents(buildId: string, signal: AbortSignal): Response {
  if (!data.buildDetail(buildId)) {
    return Response.json({ error: { code: "not_found", message: `build ${buildId} not found` } }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let poll: ReturnType<typeof setInterval> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(poll);
    clearInterval(ping);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          stop();
        }
      };
      const sent = new Set<string>();
      let lastUpdate = "";

      const tick = () => {
        const detail = data.buildDetail(buildId);
        const transcript = data.messages(buildId);
        if (!detail || !transcript || !detail.status) return;

        const update: BuildUpdatedEvent = { status: detail.status, spec_version: detail.spec_version ?? null };
        const updateKey = `${update.status}:${update.spec_version}`;
        if (updateKey !== lastUpdate) {
          lastUpdate = updateKey;
          send(`event: ${BUILD_EVENT.buildUpdated}\ndata: ${JSON.stringify(update)}\n\n`);
        }
        for (const message of transcript.messages) {
          if (sent.has(message.id)) continue;
          sent.add(message.id);
          const event: MessageCreatedEvent = { message };
          send(`id: ${message.id}\nevent: ${BUILD_EVENT.messageCreated}\ndata: ${JSON.stringify(event)}\n\n`);
        }
      };

      send("retry: 3000\n\n");
      tick();
      poll = setInterval(tick, POLL_MS);
      ping = setInterval(() => send(": ping\n\n"), PING_MS);
      signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel: stop,
  });

  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}
