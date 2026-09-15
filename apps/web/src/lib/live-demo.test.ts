import { afterEach, describe, expect, it } from "vitest";
import { liveDemoUrl } from "./live-demo";

const set = (value: string | undefined) => {
  if (value === undefined) delete process.env.LIVE_DEMO_URL;
  else process.env.LIVE_DEMO_URL = value;
};
afterEach(() => set(undefined));

describe("liveDemoUrl", () => {
  it("is absent until a destination is configured", () => {
    set(undefined);
    expect(liveDemoUrl()).toBeNull();
    set("   ");
    expect(liveDemoUrl()).toBeNull();
  });

  it("keeps an internal path as a path", () => {
    set("/live/abc");
    expect(liveDemoUrl()).toBe("/live/abc");
  });

  it("accepts an absolute http(s) destination", () => {
    set("https://plant-a.example/dashboard");
    expect(liveDemoUrl()).toBe("https://plant-a.example/dashboard");
  });

  it("refuses anything that isn't http(s), so a typo can't become a link somewhere unintended", () => {
    for (const bad of ["javascript:alert(1)", "//evil.example", "data:text/html,x", "plant-a.local", "ftp://host/x"]) {
      set(bad);
      expect(liveDemoUrl(), bad).toBeNull();
    }
  });
});
