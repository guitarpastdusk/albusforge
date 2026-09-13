import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows `limit` hits per sliding window per key, then says how long to wait", () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(2, 60_000, () => now);
    expect(limiter.take("a")).toBe(0);
    now += 10_000;
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBe(50_000);
    expect(limiter.take("b")).toBe(0);
    now += 50_001; // the first hit has left the window
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBeGreaterThan(0);
  });

  it("forgets idle keys", () => {
    let now = 0;
    const limiter = new RateLimiter(5, 1000, () => now);
    for (let i = 0; i < 999; i++) limiter.take(`k${i}`);
    now += 2000;
    limiter.take("last"); // the 1000th take sweeps
    expect(limiter.size).toBe(1);
  });
});
