import "server-only";
import { routes, Showcase } from "@albusforge/schema";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { CarouselCard } from "@/components/carousel/DeviceCarousel";
import { ApiRequestError } from "./api/core";
import { apiGet } from "./api/server";
import { formatAgo } from "./format";
import { log, traceFromHeaders } from "./log";

/**
 * The landing carousel's cards, or none. The front door must render even if
 * the showcase feed is down, so a failure is logged once, with the request's
 * trace, and the carousel is simply empty.
 *
 * A 501 is gateway saying the route isn't built yet: expected, so WARNING.
 * Anything else (5xx, an HTML placeholder, a schema mismatch, a network
 * failure) is a real failure, so ERROR.
 */
export async function loadShowcaseCards(): Promise<CarouselCard[]> {
  try {
    const { cards } = await apiGet(routes.showcase.path(), Showcase);
    const now = new Date();
    return cards.map(({ last_reading_at, ...card }) => ({ ...card, age: formatAgo(last_reading_at, now) }));
  } catch (error) {
    // Let Next's own control flow (dynamic rendering, redirects) through.
    unstable_rethrow(error);
    const notBuilt = error instanceof ApiRequestError && error.status === 501;
    const reason = error instanceof Error ? error.message : String(error);
    log(notBuilt ? "WARNING" : "ERROR", `showcase unavailable; carousel shown empty: ${reason}`, {
      error,
      trace: traceFromHeaders(await headers()),
      fields: { component: "showcase" },
    });
    return [];
  }
}
