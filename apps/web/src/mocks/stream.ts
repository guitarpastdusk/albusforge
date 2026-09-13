import { STREAM_EVENTS, type DeviceStatusEvent, type ReadingEvent } from "@albusforge/schema";
import * as data from "./data";

/*
 * Mock mode's tenant stream: synthetic readings for the mock fleet's online
 * devices so the live screens can be exercised locally. Every online tile's
 * channel drifts by a small random walk within its valid range, every
 * `intervalMs`. The interval is short so `next dev` feels alive; it is not the
 * post cadence real devices will have (minutes).
 */

const encoder = new TextEncoder();

function sse(event: string, payload: unknown, id: number): Uint8Array {
  return encoder.encode(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

interface Walker {
  deviceId: string;
  channel: string;
  value: number;
  lo: number;
  hi: number;
  precision: number;
}

/** Devices the request asked for (or all), that are online and have a numeric channel to walk. */
export function walkers(devices: readonly string[]): Walker[] {
  const wanted = new Set(devices);
  return data
    .fleet()
    .systems.flatMap((s) => s.devices)
    .filter((tile) => (wanted.size === 0 || wanted.has(tile.id)) && tile.status === "online" && tile.channel?.kind === "number")
    .map((tile) => {
      const channel = tile.channel!;
      const [lo, hi] = channel.valid_range ?? [0, 100];
      const start = tile.value ? Number(tile.value.replace("−", "-")) : (lo + hi) / 2;
      return { deviceId: tile.id, channel: channel.key, value: Number.isFinite(start) ? start : (lo + hi) / 2, lo, hi, precision: channel.precision };
    });
}

/** One step of the random walk: ±0.6% of the range, clamped, at the channel's precision. */
export function step(walker: Walker, random = Math.random): Walker {
  const span = walker.hi - walker.lo;
  const next = Math.min(walker.hi, Math.max(walker.lo, walker.value + (random() - 0.5) * span * 0.012));
  return { ...walker, value: Number(next.toFixed(walker.precision)) };
}

export function mockTenantStream(tenantId: string, devices: readonly string[], signal: AbortSignal, intervalMs = 3000): Response {
  if (!data.me().tenants.some((t) => t.id === tenantId)) {
    return Response.json({ error: { code: "not_found", message: `tenant ${tenantId} not found` } }, { status: 404 });
  }
  let state = walkers(devices);
  let id = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Replay: current state on connect, as gateway will from Redis (CLOUD-PLATFORM.md §6.2).
      const now = new Date().toISOString();
      for (const w of state) {
        const status: DeviceStatusEvent = { device_id: w.deviceId, status: "online", last_reading_at: now };
        controller.enqueue(sse(STREAM_EVENTS.status, status, ++id));
      }
      timer = setInterval(() => {
        state = state.map((w) => step(w));
        const t = new Date().toISOString();
        for (const w of state) {
          const reading: ReadingEvent = { device_id: w.deviceId, channel: w.channel, v: w.value, t };
          controller.enqueue(sse(STREAM_EVENTS.reading, reading, ++id));
        }
      }, intervalMs);
      signal.addEventListener("abort", () => {
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
