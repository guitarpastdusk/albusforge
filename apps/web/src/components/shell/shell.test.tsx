import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/live/bed-a" }));

const { Header, HeaderMenu } = await import("./Header");
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

describe("Header below lg", () => {
  it("keeps the design's header from lg up: desktop nav and account show at lg, the menu button hides", () => {
    const html = renderToStaticMarkup(<Header user={{ email: "review@example.com", displayName: null }} />);
    expect(html).toMatch(/<nav aria-label="Primary" class="ml-3 hidden min-w-0 gap-2 overflow-x-auto lg:flex">/);
    expect(html).toContain('class="ml-auto hidden shrink-0 items-center gap-3.5 lg:flex"');
    expect(html).toMatch(/<button type="button" aria-expanded="false" aria-controls="site-menu"[^>]*class="[^"]*lg:hidden"/);
  });

  it("the menu button names the signed-in account, starts collapsed, and renders no menu until opened", () => {
    const html = renderToStaticMarkup(<Header user={{ email: "a.very.long.name.for.testing@some-long-subdomain.example.com", displayName: null }} />);
    expect(html).toContain('aria-label="Menu, signed in as a.very.long.name.for.testing@some-long-subdomain.example.com"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('id="site-menu"');
    expect(renderToStaticMarkup(<Header user={null} />)).toContain('aria-label="Menu"');
  });

  const items = (signedIn: boolean) =>
    [
      { href: "/", label: "Build", isActive: (p: string) => p === "/" },
      ...(signedIn
        ? [
            { href: "/projects", label: "Projects", isActive: (p: string) => p.startsWith("/projects"), signedIn: true as const },
            { href: "/live", label: "Live systems", isActive: (p: string) => p.startsWith("/live"), signedIn: true as const },
          ]
        : []),
      { href: "/marketplace", label: "Marketplace", isActive: (p: string) => p.startsWith("/marketplace") },
    ];

  it("signed in, the menu holds every nav item, the full email (wrapping) and Sign out", () => {
    const email = "a.very.long.name.for.testing@some-long-subdomain.example.com";
    const html = renderToStaticMarkup(
      <HeaderMenu id="site-menu" items={items(true)} pathname="/live" user={{ email, displayName: null }} pending={false} onNavigate={() => {}} />,
    );
    expect([...html.matchAll(/<li><a[^>]*>([^<]*)<\/a><\/li>/g)].map((m) => m[1])).toEqual(["Build", "Projects", "Live systems", "Marketplace"]);
    expect(html).toMatch(/aria-current="page"[^>]*href="\/live"/);
    expect(html).toMatch(new RegExp(`<span class="[^"]*break-all[^"]*">${email.replace(/\./g, "\\.")}</span>`));
    expect(html).toMatch(/<button type="submit"[^>]*>Sign out<\/button>/);
  });

  it("caps the menu to the viewport below the header and scrolls it, so Sign out stays reachable in landscape", () => {
    const html = renderToStaticMarkup(
      <HeaderMenu id="site-menu" items={items(true)} pathname="/" user={{ email: "review@example.com", displayName: null }} pending={false} onNavigate={() => {}} />,
    );
    const panelClass = html.match(/<div id="site-menu" class="([^"]*)"/)?.[1] ?? "";
    expect(panelClass.split(" ")).toEqual(expect.arrayContaining(["max-h-[calc(100dvh-100%)]", "overflow-y-auto", "overscroll-contain"]));
  });

  it("signed out, the menu holds Build, Marketplace, Sign in and Get started; pending shows the nav only", () => {
    const html = renderToStaticMarkup(<HeaderMenu id="site-menu" items={items(false)} pathname="/" user={null} pending={false} onNavigate={() => {}} />);
    expect(html).toContain(">Sign in</a>");
    expect(html).toContain("Get started");
    expect(html).not.toContain("Sign out");
    const pending = renderToStaticMarkup(<HeaderMenu id="site-menu" items={items(false)} pathname="/" user={null} pending onNavigate={() => {}} />);
    expect(pending).not.toContain("Sign in");
    expect(pending).toContain(">Marketplace</a>");
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
