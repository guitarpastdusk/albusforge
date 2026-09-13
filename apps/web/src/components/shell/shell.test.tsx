import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/live/bed-a" }));

const { Header } = await import("./Header");
const { Footer } = await import("./Footer");

const navLabels = (html: string) =>
  [...(html.match(/<nav aria-label="Primary"[^>]*>(.*?)<\/nav>/)?.[1] ?? "").matchAll(/<a[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);

describe("Header", () => {
  it("logged out: Build and Marketplace only, with Sign in and Get started", () => {
    const html = renderToStaticMarkup(<Header user={null} />);
    expect(navLabels(html)).toEqual(["Build", "Marketplace"]);
    expect(html).toContain('href="/signin"');
    expect(html).toContain("Get started");
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain('href="/projects"');
    expect(html).not.toContain('href="/live"');
  });

  it("logged in: all four nav items, the avatar initials, the email and Sign out", () => {
    const html = renderToStaticMarkup(<Header user={{ email: "sam.lee@example.org", displayName: null }} />);
    expect(navLabels(html)).toEqual(["Build", "Projects", "Live systems", "Marketplace"]);
    expect(html).toMatch(/aria-current="page"[^>]*href="\/live">Live systems/);
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>SL<\/span>/);
    expect(html).toContain("sam.lee@example.org");
    expect(html).toMatch(/<form[^>]*>.*<button type="submit"[^>]*>Sign out<\/button><\/form>/);
    expect(html).not.toContain("Get started");
  });

  it("while the session loads: public nav, and neither Sign in nor the user", () => {
    const html = renderToStaticMarkup(<Header user={null} pending />);
    expect(navLabels(html)).toEqual(["Build", "Marketplace"]);
    expect(html).not.toContain("Sign in");
    expect(html).not.toContain("Sign out");
  });
});

describe("Footer", () => {
  it("links About us next to Docs, Pricing and Security pledge", () => {
    const html = renderToStaticMarkup(<Footer />);
    const links = [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
    expect(links).toEqual([
      ["/about", "About us"],
      ["/docs", "Docs"],
      ["/pricing", "Pricing"],
      ["/security", "Security pledge"],
    ]);
  });
});
