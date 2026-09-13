// @vitest-environment happy-dom
import { existsSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DocsPage from "./page";
import SecurityPage from "../security/page";

function render(page: React.ReactNode) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(page);
  return container;
}

describe("public guides", () => {
  it("gives every navigation link a unique labelled section", () => {
    const page = render(<DocsPage />);
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    const links = page.querySelectorAll('nav[aria-label="On this page"] a');
    expect(links).toHaveLength(5);
    for (const link of links) {
      const target = link.getAttribute("href")!;
      expect(page.querySelectorAll(target)).toHaveLength(1);
      const heading = page.querySelector(target)!;
      expect(heading.tagName).toBe("H2");
      expect(heading.closest("section")?.getAttribute("aria-labelledby")).toBe(heading.id);
    }
  });

  it("links to actual public routes and repository sources", () => {
    const routes = new Set(["/", "/signup", "/signin", "/security", "/docs"]);
    const repo = path.resolve(import.meta.dirname, "../../../../../..");
    for (const component of [<DocsPage key="docs" />, <SecurityPage key="security" />]) {
      for (const link of render(component).querySelectorAll("a")) {
        const href = link.getAttribute("href")!;
        expect(link.textContent?.trim().length).toBeGreaterThan(0);
        if (href.startsWith("#")) continue;
        if (href.startsWith("/")) expect(routes.has(href)).toBe(true);
        else {
          const prefix = "https://github.com/guitarpastdusk/albusforge/blob/main/";
          expect(href.startsWith(prefix)).toBe(true);
          expect(existsSync(path.join(repo, href.slice(prefix.length).split("#")[0]!))).toBe(true);
        }
      }
    }
  });

  it("keeps hardware and production readiness distinct from implemented APIs", () => {
    const text = render(<DocsPage />).textContent;
    expect(text).toContain("Guided flashing is not available yet");
    expect(text).toContain("fixtures, not measurements");
    expect(text).toContain("production device provisioning are still in progress");
    expect(text).toContain("gap, not a zero");
    expect(text).toContain("approximately 90 days");
    const security = render(<SecurityPage />).textContent;
    expect(security).toContain("Production rollout and policy commitments require separate verification");
    expect(security).toContain("privacy notice, and terms are still being defined");
  });
});
