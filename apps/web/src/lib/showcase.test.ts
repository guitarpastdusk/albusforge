import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, GatewayError } from "./api/core";

const TRACE = { traceId: "0123456789abcdef0123456789abcdef", spanId: "0000000000003039" };

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("./log", () => ({ log: vi.fn(), traceFromHeaders: vi.fn(() => TRACE) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("./api/server", () => ({ apiGet: vi.fn() }));

const { apiGet } = await import("./api/server");
const { unstable_rethrow } = await import("next/navigation");
const { log } = await import("./log");
const { loadShowcaseCards } = await import("./showcase");
const { exampleShowcase } = await import("./example-builds");

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(log).mockClear();
  vi.mocked(unstable_rethrow).mockReset();
});

describe("loadShowcaseCards", () => {
  it("a 501 (route not built yet): the example builds, marked as examples, nothing logged", async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiRequestError(501, "NOT_IMPLEMENTED", "GET /v1/showcase is not implemented"));

    const { cards, examples } = await loadShowcaseCards();
    expect(examples).toBe(true);
    expect(cards.map((c) => c.id)).toEqual(exampleShowcase().map((c) => c.id));
    expect(cards.every((c) => typeof c.age === "string" && !("last_reading_at" in c))).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ["a 503", new ApiRequestError(503, "unavailable", "try later")],
    ["an HTML placeholder", new GatewayError({ route: "GET /v1/showcase", status: 200, contentType: "text/html", reason: "not_json" })],
    ["JSON that isn't a showcase", new GatewayError({ route: "GET /v1/showcase", status: 200, contentType: "application/json", reason: "schema_mismatch", issues: "cards: expected array" })],
    ["a network failure", new TypeError("fetch failed")],
  ])("%s: the example builds, marked as examples, and one traced ERROR (the outage is logged, not shown as an empty carousel)", async (_label, failure) => {
    vi.mocked(apiGet).mockRejectedValue(failure);

    const { cards, examples } = await loadShowcaseCards();
    expect(examples).toBe(true);
    expect(cards.map((c) => c.id)).toEqual(exampleShowcase().map((c) => c.id));
    expect(log).toHaveBeenCalledTimes(1);
    const [severity, message, options] = vi.mocked(log).mock.calls[0]!;
    expect(severity).toBe("ERROR");
    expect(message).toContain("showcase unavailable");
    expect(options).toMatchObject({ error: failure, trace: TRACE, fields: { component: "showcase" } });
  });

  it("Next's control flow is rethrown, not logged", async () => {
    const bailout = new Error("dynamic usage");
    vi.mocked(apiGet).mockRejectedValue(bailout);
    vi.mocked(unstable_rethrow).mockImplementation((error) => {
      throw error;
    });

    await expect(loadShowcaseCards()).rejects.toBe(bailout);
    expect(log).not.toHaveBeenCalled();
  });

  it("live cards come back with their age, not marked as examples, and nothing is logged", async () => {
    const lastReading = new Date(Date.now() - 5 * 60_000).toISOString();
    vi.mocked(apiGet).mockResolvedValue({ cards: [{ id: "card-1", last_reading_at: lastReading }] });

    const { cards, examples } = await loadShowcaseCards();
    expect(examples).toBe(false);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: "card-1" });
    expect(cards[0]).not.toHaveProperty("last_reading_at");
    expect(typeof (cards[0] as { age?: unknown }).age).toBe("string");
    expect(log).not.toHaveBeenCalled();
  });
});
