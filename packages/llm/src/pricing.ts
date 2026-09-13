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
 * at the most expensive row, so spend is over-reported rather than hidden.
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

const MOST_EXPENSIVE = Object.values(PRICES_USD_PER_MTOK).reduce((a, b) => (b.output > a.output ? b : a));

export function priceFor(model: string): { price: ModelPrice; known: boolean } {
  const price = PRICES_USD_PER_MTOK[model];
  return price ? { price, known: true } : { price: MOST_EXPENSIVE, known: false };
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

/**
 * The cost of one response. When a server-side fallback ran, `usage.iterations`
 * carries one entry per model that sampled, each priced at its own model's
 * rates; otherwise the top-level usage is priced at the model that served it.
 * Compaction entries are left out: they aren't part of the top-level usage.
 */
export function costUsd(usage: LlmUsage, servedModel: string): number {
  const iterations = (usage.iterations ?? []).filter(
    (entry): entry is Extract<typeof entry, { model: string }> => entry.type !== "compaction" && "model" in entry,
  );
  if (iterations.length > 0) {
    return round6(iterations.reduce((sum, entry) => sum + costOf(entry, priceFor(entry.model).price), 0));
  }
  return round6(costOf(usage, priceFor(servedModel).price));
}
