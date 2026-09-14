import type { Listing } from "@albusforge/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { listingsQuery, MARKETPLACE_FILTERS, marketplaceHref } from "./filter";
import { ListingCard } from "./ListingCard";
import { MarketplaceView } from "./MarketplaceView";

const listing = (id: string, category: Listing["category"]): Listing => ({
  id,
  name: `Build ${id}`,
  category,
  accent: "green",
  description: "A proven build. ~$51/machine.",
  author: { handle: "priya" },
  remix_count: 88,
});

describe("marketplace URLs", () => {
  it("offers All, Garden, Home, Workshop and Industrial", () => {
    expect(MARKETPLACE_FILTERS.map((f) => f.label)).toEqual(["All", "Garden", "Home", "Workshop", "Industrial"]);
  });

  it("keeps the category and cursor in the page URL, and sends them to gateway as tags and cursor", () => {
    expect(marketplaceHref({ category: null })).toBe("/marketplace");
    expect(marketplaceHref({ category: "industrial", cursor: "c2" })).toBe("/marketplace?category=industrial&cursor=c2");
    expect(listingsQuery({ category: "industrial", cursor: "c2" })).toBe("?tags=industrial&cursor=c2");
    expect(listingsQuery({ category: null })).toBe("");
  });
});

describe("MarketplaceView", () => {
  it("pills are links that navigate, with the current one marked", () => {
    const html = renderToStaticMarkup(<MarketplaceView listings={[listing("b", "industrial")]} category="industrial" cursor={null} nextCursor={null} />);
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/marketplace\?category=industrial">Industrial<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/marketplace"[^>]*>All<\/a>/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("an empty page with a next cursor is not an empty category: it offers the next page", () => {
    const html = renderToStaticMarkup(<MarketplaceView listings={[]} category="industrial" cursor={null} nextCursor="c2" />);
    expect(html).not.toContain("No builds in this category yet.");
    expect(html).toMatch(/href="\/marketplace\?category=industrial&amp;cursor=c2"[^>]*>More builds →/);
  });

  it("says the category is empty only when gateway reports no further page", () => {
    expect(renderToStaticMarkup(<MarketplaceView listings={[]} category="home" cursor={null} nextCursor={null} />)).toContain(
      "No builds in this category yet.",
    );
  });

  it("on a later page, links back to the first page and on to the next", () => {
    const html = renderToStaticMarkup(<MarketplaceView listings={[listing("c", "garden")]} category="garden" cursor="c2" nextCursor="c3" />);
    expect(html).toMatch(/href="\/marketplace\?category=garden"[^>]*>← First page/);
    expect(html).toContain("cursor=c3");
  });
});

describe("ListingCard", () => {
  it("shows the category, name, description with price, author, clones and Open build", () => {
    const html = renderToStaticMarkup(<ListingCard listing={listing("b", "industrial")} />);
    expect(html).toContain("Industrial");
    expect(html).toContain("A proven build. ~$51/machine.");
    expect(html).toContain("by priya · 88 clones");
    expect(html).toMatch(/href="\/marketplace\/b"[^>]*>Open build →/);
  });
});
