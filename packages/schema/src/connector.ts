import { z } from "zod";
import { ConnectorId, PartInterface, SemVer } from "./part";

/**
 * A connector standard a part's `electrical.connector` names
 * (registry/connectors/<id>.json). The matcher checks connector standards
 * match (ARCHITECTURE.md §7.2); which standard wins — hsx-3pin-v1 or
 * Qwiic/Grove — is still open (§18.1).
 */
export const ConnectorPin = z.strictObject({
  n: z.number().int().positive(),
  name: z.string().min(1),
  role: z.enum(["power", "ground", "signal", "sda", "scl"]),
});
export type ConnectorPin = z.infer<typeof ConnectorPin>;

export const ConnectorDefinition = z
  .strictObject({
    $schema: z.string().optional(),
    id: ConnectorId,
    version: SemVer,
    name: z.string().min(1),
    /** Physical housing, e.g. "JST PH 2.0 mm". */
    housing: z.string().min(1),
    pins: z.array(ConnectorPin).min(2),
    /** Part interfaces this connector can carry. */
    interfaces: z.array(PartInterface).min(1),
    max_voltage: z.number().positive(),
  })
  .superRefine((connector, ctx) => {
    connector.pins.forEach((pin, i) => {
      if (pin.n !== i + 1) {
        ctx.addIssue({ code: "custom", path: ["pins", i, "n"], message: `pins are numbered 1..n in order; expected ${i + 1}` });
      }
    });
    if (!connector.pins.some((p) => p.role === "ground")) {
      ctx.addIssue({ code: "custom", path: ["pins"], message: "a connector needs a ground pin" });
    }
  });
export type ConnectorDefinition = z.infer<typeof ConnectorDefinition>;
