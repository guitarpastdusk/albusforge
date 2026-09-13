import { z } from "zod";
import { Timestamp } from "./common";

const Count = z.number().int().nonnegative();

export const TierUsage = z.object({
  model_calls: Count,
  tokens_in: Count,
  tokens_out: Count,
});
export type TierUsage = z.infer<typeof TierUsage>;

/**
 * The active tenant's usage for the current period, from `usage_records`
 * (CLOUD-PLATFORM.md §9) — shown before it is billed.
 */
export const Usage = z.object({
  period: z.object({ start: Timestamp, end: Timestamp }),
  tiers: z.object({
    tier2: TierUsage,
    tier3: TierUsage,
  }),
  readings_in: Count.optional(),
  bytes_stored: Count.optional(),
});
export type Usage = z.infer<typeof Usage>;
