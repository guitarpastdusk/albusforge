import { describe, expect, it } from "vitest";
import { awaitEgress } from "../src/egress";

/** A fetch that fails the first `failures` attempts the way undici does, then answers. */
function flakyFetch(failures: number, code = "ENOTFOUND"): { fetch: typeof globalThis.fetch; calls: () => number } {
  let calls = 0;
  const fetch = (async () => {
    calls++;
    if (calls <= failures) {
      throw Object.assign(new Error("fetch failed"), { cause: Object.assign(new Error("getaddrinfo"), { code }) });
    }
    // The API's root answers 404 to a HEAD; any answer proves the route.
    return new Response(null, { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls: () => calls };
}

/** No real waiting: the backoff is what's under test, not the clock. */
const instant = () => Promise.resolve();

describe("awaitEgress", () => {
  it("bounds itself by the backoff it intended, not only by the clock", async () => {
    // Nothing blocks on this any more, so the budget only bounds the
    // measurement — but a stubbed `sleep` must still reach it, or a route that
    // stays shut leaves the loop running for the life of the process.
    const { fetch, calls } = flakyFetch(Number.POSITIVE_INFINITY);
    const wait = await awaitEgress({ fetch, sleep: instant, budgetMs: 120_000 });
    expect(wait.ok).toBe(false);
    // 250 + 500 + 1000 + 2000, then 3000 each: ~41 attempts to spend 120 s.
    expect(calls()).toBe(wait.attempts);
    expect(wait.attempts).toBeGreaterThan(35);
    expect(wait.attempts).toBeLessThan(50);
  });

  it("returns on the first attempt when the route is already open", async () => {
    const { fetch, calls } = flakyFetch(0);
    expect(await awaitEgress({ fetch, sleep: instant })).toMatchObject({ ok: true, attempts: 1 });
    expect(calls()).toBe(1);
  });

  it("keeps trying while the route is down, and reports the transport code it saw", async () => {
    const { fetch, calls } = flakyFetch(4, "UND_ERR_CONNECT_TIMEOUT");
    const wait = await awaitEgress({ fetch, sleep: instant });
    expect(wait).toMatchObject({ ok: true, attempts: 5, lastCode: "UND_ERR_CONNECT_TIMEOUT" });
    expect(calls()).toBe(5);
  });

  it("gives up inside its budget rather than probing forever", async () => {
    const { fetch } = flakyFetch(Number.POSITIVE_INFINITY);
    // Real waits, small budget: the loop must stop on its own.
    const wait = await awaitEgress({ fetch, budgetMs: 600 });
    expect(wait.ok).toBe(false);
    expect(wait.waitedMs).toBeLessThan(2_000);
    expect(wait.attempts).toBeGreaterThan(1);
    expect(wait.lastCode).toBe("ENOTFOUND");
  });

  it("treats any HTTP answer as proof, including a rejection", async () => {
    const fetch = (async () => new Response(null, { status: 401 })) as unknown as typeof globalThis.fetch;
    expect(await awaitEgress({ fetch, sleep: instant })).toMatchObject({ ok: true, attempts: 1 });
  });
});
