import { z } from "zod";

const Time = z.iso.datetime({ offset: true });
export const SensorAskInput = z.strictObject({
  question: z.string().trim().min(1).max(2000),
  channel: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  from: Time,
  to: Time,
}).refine((q) => Date.parse(q.to) > Date.parse(q.from) && Date.parse(q.to) - Date.parse(q.from) <= 86400000,
  { message: "Choose a positive window of at most 24 hours" });
export type SensorAskInput = z.infer<typeof SensorAskInput>;
/** Trusted gateway identity; never copied from a browser request. Cloud Run IAM authenticates the caller. */
export const SensorAskRequest = SensorAskInput.safeExtend({
  request_id: z.uuid(), actor_id: z.uuid(), tenant_id: z.uuid(), device_id: z.uuid(),
});
export type SensorAskRequest = z.infer<typeof SensorAskRequest>;
export const SensorAskEvidence = z.strictObject({
  from: Time, to: Time, unit: z.string().max(64), count: z.number().int().min(0).max(10000),
  min: z.number().finite().nullable(), max: z.number().finite().nullable(), mean: z.number().finite().nullable(),
  latest: z.strictObject({ t: Time, v: z.number().finite() }).nullable(),
});
export type SensorAskEvidence = z.infer<typeof SensorAskEvidence>;
export const SensorAskResponse = z.strictObject({
  request_id: z.uuid(), device_id: z.uuid(), channel: z.string(), answer: z.string().max(8000),
  evidence: SensorAskEvidence, mode: z.enum(["model", "evidence_only"]), limitations: z.array(z.string().max(500)).max(10),
});
export type SensorAskResponse = z.infer<typeof SensorAskResponse>;
