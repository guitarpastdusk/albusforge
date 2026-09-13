import "server-only";
import { routes, Showcase, type ShowcaseCard } from "@albusforge/schema";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { CarouselCard } from "@/components/carousel/DeviceCarousel";
import { isNotImplemented } from "./api/core";
import { apiGet } from "./api/server";
import { exampleShowcase } from "./example-builds";
import { formatAgo } from "./format";
import { log, traceFromHeaders } from "./log";

export interface ShowcaseCards {
  cards: CarouselCard[];
  /** True when the cards are example builds (lib/example-builds.ts), not gateway's live showcase. */
  examples: boolean;
}

const toCarousel = (cards: ShowcaseCard[], now: Date): CarouselCard[] =>
  cards.map(({ last_reading_at, ...card }) => ({ ...card, age: formatAgo(last_reading_at, now) }));

/**
 * The landing carousel's cards. The front door must render whatever the
 * showcase feed does:
 *
 * - A 501 is gateway saying the route isn't built yet: show the example
 *   builds, labelled as examples. Expected, so nothing is logged.
 * - Any other failure (5xx, an HTML placeholder, a schema mismatch, a
 *   network failure) is a real failure: logged once as ERROR, with the
 *   request's trace, and the carousel is simply empty.
 */
export async function loadShowcaseCards(): Promise<ShowcaseCards> {
  const now = new Date();
  try {
    const { cards } = await apiGet(routes.showcase.path(), Showcase);
    return { cards: toCarousel(cards, now), examples: false };
  } catch (error) {
    // Let Next's own control flow (dynamic rendering, redirects) through.
    unstable_rethrow(error);
    if (isNotImplemented(error)) return { cards: toCarousel(exampleShowcase(now), now), examples: true };
    const reason = error instanceof Error ? error.message : String(error);
    log("ERROR", `showcase unavailable; carousel shown empty: ${reason}`, {
      error,
      trace: traceFromHeaders(await headers()),
      fields: { component: "showcase" },
    });
    return { cards: [], examples: false };
  }
}
