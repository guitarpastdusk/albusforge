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

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(log).mockClear();
  vi.mocked(unstable_rethrow).mockReset();
});

describe("loadShowcaseCards", () => {
  it("a 501 (route not built yet): no cards, one traced WARNING", async () => {
    const failure = new ApiRequestError(501, "NOT_IMPLEMENTED", "GET /v1/showcase is not implemented");
    vi.mocked(apiGet).mockRejectedValue(failure);

    await expect(loadShowcaseCards()).resolves.toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    const [severity, message, options] = vi.mocked(log).mock.calls[0]!;
    expect(severity).toBe("WARNING");
    expect(message).toContain("GET /v1/showcase is not implemented");
    expect(options).toMatchObject({ error: failure, trace: TRACE, fields: { component: "showcase" } });
  });

  it.each([
    ["a 503", new ApiRequestError(503, "unavailable", "try later")],
    ["an HTML placeholder", new GatewayError({ route: "GET /v1/showcase", status: 200, contentType: "text/html", reason: "not_json" })],
    ["JSON that isn't a showcase", new GatewayError({ route: "GET /v1/showcase", status: 200, contentType: "application/json", reason: "schema_mismatch", issues: "cards: expected array" })],
    ["a network failure", new TypeError("fetch failed")],
  ])("%s: no cards, one traced ERROR", async (_label, failure) => {
    vi.mocked(apiGet).mockRejectedValue(failure);

    await expect(loadShowcaseCards()).resolves.toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log).mock.calls[0]![0]).toBe("ERROR");
    expect(vi.mocked(log).mock.calls[0]![2]).toMatchObject({ error: failure, trace: TRACE });
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

  it("cards come back with their age, and nothing is logged", async () => {
    const lastReading = new Date(Date.now() - 5 * 60_000).toISOString();
    vi.mocked(apiGet).mockResolvedValue({ cards: [{ id: "card-1", last_reading_at: lastReading }] });

    const cards = await loadShowcaseCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: "card-1" });
    expect(cards[0]).not.toHaveProperty("last_reading_at");
    expect(typeof (cards[0] as { age?: unknown }).age).toBe("string");
    expect(log).not.toHaveBeenCalled();
  });
});
