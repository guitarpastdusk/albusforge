import type { LlmUsage } from "./types";

/**
 * USD per million tokens, first-party Claude API, global inference.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/pricing ("Model
 * pricing" table), read 2026-09-13. Cache writes are 1.25x input for the
 * 5-minute TTL and 2x for 1 hour; cache hits are 0.1x input (0.025x on Claude
 * Fable 5.1). Thinking tokens are billed inside output_tokens.
 *
 * Update this table when the page changes. A model missing from it is priced
 * at `UNKNOWN_MODEL_PRICE`, the component-wise maximum of these rows.
 */
export interface ModelPrice {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export const PRICES_USD_PER_MTOK: Readonly<Record<string, ModelPrice>> = {
  "claude-fable-5-1": { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50 },
  "claude-opus-5": { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  "claude-opus-4-8": { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  "claude-sonnet-5": { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
  "claude-haiku-4-5": { input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 },
};

/**
 * The price of an unrecognised model: the highest rate in *each* token
 * category across the table, not the most expensive row. A whole row
 * under-reports any mix that row happens to be cheap at — Fable 5.1 has the
 * highest output price but a lower cache-read price than Opus, so a
 * cache-dominated call priced from it would come out below the Opus rate.
 *
 * This bounds an unknown model above every model listed here. It remains an
 * estimate: a future model priced above all of these is under-reported until
 * its row is added, which is what the `onUnknownModel` warning is for.
 */
export const UNKNOWN_MODEL_PRICE: ModelPrice = Object.values(PRICES_USD_PER_MTOK).reduce((max, price) => ({
  input: Math.max(max.input, price.input),
  cacheWrite5m: Math.max(max.cacheWrite5m, price.cacheWrite5m),
  cacheWrite1h: Math.max(max.cacheWrite1h, price.cacheWrite1h),
  cacheRead: Math.max(max.cacheRead, price.cacheRead),
  output: Math.max(max.output, price.output),
}));

export function priceFor(model: string): { price: ModelPrice; known: boolean } {
  const price = PRICES_USD_PER_MTOK[model];
  return price ? { price, known: true } : { price: UNKNOWN_MODEL_PRICE, known: false };
}

interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null;
}

function costOf(counts: TokenCounts, price: ModelPrice): number {
  const created = counts.cache_creation_input_tokens ?? 0;
  // The TTL breakdown when the API gives one; otherwise every write is the 5-minute kind we request.
  const write1h = counts.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = counts.cache_creation ? counts.cache_creation.ephemeral_5m_input_tokens : created;
  return (
    (counts.input_tokens * price.input +
      write5m * price.cacheWrite5m +
      write1h * price.cacheWrite1h +
      (counts.cache_read_input_tokens ?? 0) * price.cacheRead +
      counts.output_tokens * price.output) /
    1_000_000
  );
}

const round6 = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000;

type PricedIteration = TokenCounts & { model: string };

/** The fallback iterations carrying their own usage; compaction isn't part of the top-level usage. */
function pricedIterations(usage: LlmUsage): PricedIteration[] {
  const iterations = (usage.iterations ?? []).filter(
    (entry): entry is Extract<typeof entry, { model: string }> => entry.type !== "compaction" && "model" in entry,
  );
  return iterations as unknown as PricedIteration[];
}

/**
 * Every model this response is priced from: one per fallback iteration when
 * the API reports them, otherwise the model that served the response. Callers
 * warn on the ones missing from the table, whichever way they got here.
 */
export function pricedModels(usage: LlmUsage, servedModel: string): string[] {
  const iterations = pricedIterations(usage);
  return iterations.length > 0 ? iterations.map((entry) => entry.model) : [servedModel];
}

/**
 * The cost of one response. When a server-side fallback ran, `usage.iterations`
 * carries one entry per model that sampled, each priced at its own model's
 * rates; otherwise the top-level usage is priced at the model that served it.
 * Compaction entries are left out: they aren't part of the top-level usage.
 */
export function costUsd(usage: LlmUsage, servedModel: string): number {
  const iterations = pricedIterations(usage);
  if (iterations.length > 0) {
    return round6(iterations.reduce((sum, entry) => sum + costOf(entry, priceFor(entry.model).price), 0));
  }
  return round6(costOf(usage, priceFor(servedModel).price));
}
