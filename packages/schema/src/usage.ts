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

/** Live /v1/usage: recorded consumption, not invoices or inferred plan entitlements. */
const ExactCount = z.string().regex(/^\d+$/);
export const ModelConsumption = z.strictObject({
  calls: ExactCount,
  input_tokens: ExactCount,
  output_tokens: ExactCount,
  cache_read_tokens: ExactCount,
  cache_creation_tokens: ExactCount,
  cost_usd: z.string().regex(/^\d+\.\d{6}$/),
});
export const UsageStage = z.enum(["intake", "codegen", "bodygen", "narration", "ask", "explain", "other"]);
export const UsageSummary = z.object({
  period: z.strictObject({ start: Timestamp, end: Timestamp }),
  as_of: Timestamp,
  model: z.strictObject({
    total: ModelConsumption,
    stages: z.array(ModelConsumption.extend({ stage: UsageStage })).max(7),
  }),
  telemetry: z.strictObject({ readings_in: ExactCount, payload_bytes: ExactCount }),
  // Additive rollout: absence means the serving gateway predates image usage.
  images: z.strictObject({ accepted_count: ExactCount, accepted_bytes: ExactCount }).optional(),
});
export type UsageSummary = z.infer<typeof UsageSummary>;
export type ModelConsumption = z.infer<typeof ModelConsumption>;
