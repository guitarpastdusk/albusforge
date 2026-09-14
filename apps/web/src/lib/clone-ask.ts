import type { Listing } from "@albusforge/schema";

/*
 * "Clone build" on the Marketplace. Gateway's remix route (POST
 * /v1/listings/:id/remix) isn't built, so cloning a build means starting a
 * new conversation from its description: the home page reads `?ask=` into
 * the input, and the viewer sends it. Tracked in docs/DEMO-ASSUMPTIONS.md.
 */

/** Longest `?ask=` the home page will seed into the input. */
export const MAX_CLONE_ASK = 600;

/** "Build me a fridge monitor: temperature and humidity inside the fridge…" — the listing, as a request. */
export function cloneAskFor(listing: Pick<Listing, "name" | "description">): string {
  // The listing's description ends with its price ("About $51 in parts."), which isn't part of the ask.
  const description = listing.description.replace(/\s*(?:About|From) \$\d[\d,]*(?:\.\d+)? in parts\.\s*$/, "").trim();
  const lead = description.charAt(0).toLowerCase() + description.slice(1);
  return `Build me a ${listing.name.toLowerCase()}: ${lead}`.slice(0, MAX_CLONE_ASK);
}

/** Where "Clone build" goes: the home page with the ask filled in. */
export function cloneHref(listing: Pick<Listing, "name" | "description">): string {
  return `/?ask=${encodeURIComponent(cloneAskFor(listing))}`;
}

/** The `?ask=` a page was opened with, or "" when there is none or it's too long to be a real request. */
export function seededAsk(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_CLONE_ASK ? trimmed : "";
}
