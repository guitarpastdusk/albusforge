import { z } from "zod";

/**
 * The structured spec intake produces (ARCHITECTURE.md §7.1, ASK-TO-ENCLOSURE.md
 * §3), the per-turn shape the model returns, and intake's internal turn API.
 *
 * `SpecTurn` is also the model's structured-output schema (`output_config.format`),
 * so its string limits and optional fields shape what the model is asked for.
 * Registry vocabulary (capability ids, environment flags) can't be expressed
 * here: intake checks it after parsing and drops what isn't on the menu.
 */

export const Transport = z.enum(["wifi", "ble", "lora", "none"]);
export type Transport = z.infer<typeof Transport>;

export const PowerSource = z.enum(["battery", "solar", "usb", "unknown"]);
export type PowerSource = z.infer<typeof PowerSource>;

const Short = z.string().max(120);
const Sentence = z.string().max(300);

/** A registry capability id, e.g. `read.temperature_c`. */
export const CapabilityId = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/);

/** A question tied to the spec field its answer resolves, e.g. `power.source`. */
export const OpenQuestion = z.object({
  field: z.string().min(1).max(64),
  question: z.string().min(1).max(300),
});
export type OpenQuestion = z.infer<typeof OpenQuestion>;

const Sense = z.object({
  what: z.array(Short).max(12),
  accuracy: Short.optional(),
  interval_s: z.number().positive().optional(),
});
const Act = z.object({ what: z.array(Short).max(12) });
const Environment = z.object({ location: Short, flags: z.array(z.string().max(64)).max(16) });
const Connect = z.object({ transport: Transport, experience: z.array(Short).max(12) });
const Power = z.object({ source: PowerSource, target_life_days: z.number().positive().optional() });
const Experience = z.object({ alerts: z.array(Short).max(12).optional(), dashboard: z.boolean().optional() });

/** Everything in a spec except `settled`, which only intake's code decides. */
export const SpecBody = z.object({
  sense: Sense,
  act: Act.optional(),
  environment: Environment,
  connect: Connect,
  power: Power,
  experience: Experience,
  /** Registry capability ids the device needs. */
  capabilities: z.array(CapabilityId).max(24),
  /** Defaults applied without the person's answer, shown to them. */
  assumptions: z.array(Sentence).max(20),
  open_questions: z.array(OpenQuestion).max(6),
});
export type SpecBody = z.infer<typeof SpecBody>;

/** What `builds.specs.data` stores: a full spec, every version. */
export const Spec = SpecBody.extend({
  /** True once intake hands the spec to the matcher. */
  settled: z.boolean(),
});
export type Spec = z.infer<typeof Spec>;

/**
 * DeepPartial<SpecBody>: only the fields a turn changes. Arrays replace the
 * previous value. Capability ids are plain strings here so one unknown id
 * doesn't fail the whole turn; intake validates them against the registry.
 */
export const SpecPatch = z.object({
  sense: Sense.partial().optional(),
  act: Act.partial().optional(),
  environment: Environment.partial().optional(),
  connect: Connect.partial().optional(),
  power: Power.partial().optional(),
  experience: Experience.partial().optional(),
  capabilities: z.array(z.string().max(64)).max(24).optional(),
  assumptions: z.array(Sentence).max(20).optional(),
  open_questions: z.array(OpenQuestion).max(6).optional(),
});
export type SpecPatch = z.infer<typeof SpecPatch>;

/**
 * What a turn was: a message about the device being built, or one that isn't
 * about building a device at all. Intake writes the reply itself for
 * `off_topic`, so the model's own prose can't wander into answering it. An
 * empty `spec_patch` can't stand in for this — a turn that only chats about
 * the build in progress produces one too.
 */
export const ReplyKind = z.enum(["spec", "off_topic"]);
export type ReplyKind = z.infer<typeof ReplyKind>;

/** One model turn. Intake decides which questions survive and whether the spec settles. */
export const SpecTurn = z.object({
  reply_kind: ReplyKind,
  spec_patch: SpecPatch,
  candidate_questions: z.array(OpenQuestion).max(6),
  assumptions: z.array(Sentence).max(10),
  reply: z.string().min(1).max(2000),
});
export type SpecTurn = z.infer<typeof SpecTurn>;

// --- intake's internal API (called by gateway with an ID token; Cloud Run checks it) ---

/**
 * `may_retry` says the caller will try this turn again if intake doesn't
 * answer it, so a transient failure can come back as a 503 with nothing
 * written instead of spending the person's message on a fallback reply.
 * Absent means no: an older caller, or the caller's own last attempt, and
 * intake writes the reply it has.
 */
export const IntakeTurnRequest = z.object({ build_id: z.uuid(), may_retry: z.boolean().default(false) });
export type IntakeTurnRequest = z.infer<typeof IntakeTurnRequest>;

/** Build statuses intake sets. */
export const IntakeBuildStatus = z.enum(["specifying", "asking", "planning"]);
export type IntakeBuildStatus = z.infer<typeof IntakeBuildStatus>;

export const IntakeTurnResponse = z.union([
  z.object({
    /** The assistant message written for the latest user message. */
    message_id: z.uuid(),
    /** The build's latest spec version after the turn; null if it has none. */
    spec_version: z.number().int().positive().nullable(),
    status: IntakeBuildStatus,
  }),
  /** Nothing to answer: the latest message already has a reply, or another call is answering it. */
  z.object({ noop: z.literal(true) }),
]);
export type IntakeTurnResponse = z.infer<typeof IntakeTurnResponse>;
