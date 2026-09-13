import type { Listing } from "@albusforge/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { filterListings, MARKETPLACE_FILTERS } from "./filter";
import { ListingCard } from "./ListingCard";
import { MarketplaceBrowser } from "./MarketplaceBrowser";

const listing = (id: string, category: Listing["category"]): Listing => ({
  id,
  name: `Build ${id}`,
  category,
  accent: "green",
  description: "A proven build. ~$51/machine.",
  author: { handle: "priya" },
  remix_count: 88,
});

const LISTINGS = [listing("a", "garden"), listing("b", "industrial"), listing("c", "industrial")];

describe("filterListings", () => {
  it("keeps everything for All and only the category otherwise", () => {
    expect(filterListings(LISTINGS, null)).toHaveLength(3);
    expect(filterListings(LISTINGS, "industrial").map((l) => l.id)).toEqual(["b", "c"]);
    expect(filterListings(LISTINGS, "home")).toEqual([]);
  });

  it("offers All, Garden, Home, Workshop and Industrial", () => {
    expect(MARKETPLACE_FILTERS.map((f) => f.label)).toEqual(["All", "Garden", "Home", "Workshop", "Industrial"]);
  });
});

describe("MarketplaceBrowser", () => {
  it("renders the pills with the initial one pressed, and only that category's cards", () => {
    const html = renderToStaticMarkup(<MarketplaceBrowser listings={LISTINGS} initialCategory="industrial" />);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Industrial</);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).not.toContain("Build a");
    expect(html).toContain("Build b");
  });
});

describe("ListingCard", () => {
  it("shows the category, name, description with price, author, clones and Clone build", () => {
    const html = renderToStaticMarkup(<ListingCard listing={listing("b", "industrial")} />);
    expect(html).toContain("Industrial");
    expect(html).toContain("A proven build. ~$51/machine.");
    expect(html).toContain("by priya · 88 clones");
    expect(html).toMatch(/href="\/marketplace\/b"[^>]*>Clone build →/);
  });
});
