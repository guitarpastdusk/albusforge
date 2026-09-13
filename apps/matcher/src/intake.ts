import { z } from "zod";
import { SolveSpec } from "./types";

/** Read M2's authoritative capability IDs; never guess IDs from sense.what prose. */
const IntakeSpec = z.object({
  settled: z.literal(true),
  capabilities: SolveSpec.shape.capabilities,
  sense: z.object({ interval_s: z.number().positive(), accuracy: z.string().optional() }),
  environment: z.object({ flags: z.array(z.string()) }),
  connect: z.object({ transport: SolveSpec.shape.transport }),
  power: z.object({ source: SolveSpec.shape.power_source, target_life_days: z.number().positive().optional() }),
  open_questions: z.array(z.unknown()).length(0),
});

export function fromIntakeSpec(value: unknown, runtime: string): SolveSpec {
  const spec = IntakeSpec.parse(value);
  // Environmental/accuracy guarantees need registry attributes beyond the
  // five M3 constraints. Refuse them until they can actually be checked.
  if (spec.environment.flags.length || spec.sense.accuracy?.trim()) {
    throw new Error("Environmental flags and accuracy requirements need a matcher model before solving");
  }
  return SolveSpec.parse({ capabilities: spec.capabilities, interval_s: spec.sense.interval_s,
    transport: spec.connect.transport, power_source: spec.power.source,
    target_life_days: spec.power.target_life_days, runtime });
}
