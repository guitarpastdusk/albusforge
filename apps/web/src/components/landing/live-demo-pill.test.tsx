import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { LiveDemoPill } from "./LiveDemoPill";

afterEach(() => delete process.env.LIVE_DEMO_URL);

describe("LiveDemoPill", () => {
  it("renders nothing when no destination is configured", () => {
    // Every device page needs a session, so an unconfigured pill would send a
    // visitor to a sign-in wall. Showing nothing is the correct default.
    expect(renderToStaticMarkup(<LiveDemoPill />)).toBe("");
  });

  it("links out, in a new tab, when the destination is external", () => {
    process.env.LIVE_DEMO_URL = "https://plant-a.example/";
    const html = renderToStaticMarkup(<LiveDemoPill />);
    expect(html).toContain('href="https://plant-a.example/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("noreferrer");
    expect(html).toContain("Live demo");
  });

  it("stays in the app for an internal path", () => {
    process.env.LIVE_DEMO_URL = "/live/abc";
    const html = renderToStaticMarkup(<LiveDemoPill />);
    expect(html).toContain('href="/live/abc"');
    expect(html).not.toContain('target="_blank"');
  });
});
