import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const pending = mapWithConcurrency(Array.from({ length: 9 }, (_v, i) => i), 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise<void>((resolve) => release.push(resolve));
      running -= 1;
      return n * 2;
    });
    // Let every queued worker start and finish, one release at a time.
    while (release.length > 0) {
      expect(peak).toBeLessThanOrEqual(3);
      release.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(await pending).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16]);
    expect(peak).toBe(3);
  });

  it("keeps input order however the work completes", async () => {
    const out = await mapWithConcurrency(["slow", "fast", "medium"], 3, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, item === "slow" ? 12 : item === "medium" ? 6 : 0));
      return item;
    });
    expect(out).toEqual(["slow", "fast", "medium"]);
  });

  it("handles fewer items than the limit, and none", async () => {
    expect(await mapWithConcurrency([1], 5, async (n) => n)).toEqual([1]);
    expect(await mapWithConcurrency([], 5, async (n) => n)).toEqual([]);
  });

  it("refuses a limit that would stall", async () => {
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toThrow(/at least 1/);
  });
});
