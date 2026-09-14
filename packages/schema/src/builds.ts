import { z } from "zod";
import { Accent, Id, Timestamp } from "./common";
import { Capability } from "./part";
import { PartSummary } from "./parts";

/**
 * What the Projects screen shows. Derived server-side from build status and
 * order status together — the portal never reconstructs it.
 */
export const DisplayStatus = z.enum(["designing", "parts_picked", "kit_shipped", "live"]);

/**
 * Text a person types: trimmed, non-empty, at most `max` characters, and free
 * of control characters other than tab, newline and carriage return (NUL can't
 * be stored in Postgres text at all).
 */
const PersonText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, "must not contain control characters other than tab and newline");
export type DisplayStatus = z.infer<typeof DisplayStatus>;

/** The build status machine (ARCHITECTURE.md §5), as stored in `builds.builds.status`. */
export const BuildStatus = z.enum(["asking", "specifying", "planning", "coding", "bodying", "ready", "ordered"]);
export type BuildStatus = z.infer<typeof BuildStatus>;

export const BuildSummary = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  display_status: DisplayStatus,
  device_count: z.number().int().nonnegative(),
  updated_at: Timestamp,
});
export type BuildSummary = z.infer<typeof BuildSummary>;

export const BuildList = z.object({
  builds: z.array(BuildSummary),
});
export type BuildList = z.infer<typeof BuildList>;

export const PartChip = z.object({
  part_id: Id,
  label: z.string(),
  accent: Accent,
});
export type PartChip = z.infer<typeof PartChip>;

/** The card that appears in the landing chat once a design is ready. */
export const DeviceReadyCard = z.object({
  name: z.string(),
  est_price_usd: z.number().nonnegative(),
  fulfillment_note: z.string(),
  parts: z.array(PartChip),
});
export type DeviceReadyCard = z.infer<typeof DeviceReadyCard>;

/**
 * A registry part whose `software.capabilities` intersect the latest spec's
 * `capabilities`. **A capability match, not a solved plan**: no wiring, power,
 * conflict or quantity check has run. The matcher (M3) replaces it with a
 * BuildPlan.
 */
export const CandidatePart = PartSummary.extend({
  /** The spec capabilities this part provides, sorted. */
  matched_capabilities: z.array(Capability).min(1),
});
export type CandidatePart = z.infer<typeof CandidatePart>;

export const BuildDetail = BuildSummary.extend({
  /** Present once the plan is solved; null while the conversation is still going. */
  ready: DeviceReadyCard.nullable(),
  // The fields below are always sent by gateway from M2. They are optional so
  // the portal's mock data and older responses still parse.
  status: BuildStatus.optional(),
  /** The latest `builds.specs` version; null before intake has written one. */
  spec_version: z.number().int().positive().nullable().optional(),
  /** The latest spec (`builds.specs.data`) as intake wrote it; null before the first one. */
  spec: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Capability match against the latest spec, sorted by part id. Not a plan: see CandidatePart. */
  candidate_parts: z.array(CandidatePart).optional(),
});
export type BuildDetail = z.infer<typeof BuildDetail>;

export const CreateBuildRequest = z.object({
  ask_text: PersonText(2000),
  /**
   * Workspace displayed when the caller initiated creation; null means anonymous.
   * The gateway compares this with its authorized owner, never uses it to select
   * a tenant. Omission supports older clients; workspace-aware clients send it.
   */
  expected_tenant_id: z.uuid().nullable().optional(),
  /**
   * Client-generated, stored on the first message. Resending the same id with
   * the same anonymous owner cookie returns the build already created (200)
   * instead of creating another.
   */
  client_message_id: z.uuid().optional(),
});
export type CreateBuildRequest = z.infer<typeof CreateBuildRequest>;

export const CreateBuildResponse = z.object({
  build_id: Id,
  status: z.string(),
});
export type CreateBuildResponse = z.infer<typeof CreateBuildResponse>;

/**
 * What gateway answers to `POST /v1/builds`: the build's detail (201, or 200
 * for a replayed client_message_id) plus `build_id`, so a client reading
 * CreateBuildResponse keeps working.
 */
export const CreatedBuild = BuildDetail.extend({
  build_id: Id,
  status: BuildStatus,
});
export type CreatedBuild = z.infer<typeof CreatedBuild>;

export const ChatMessage = z.object({
  id: Id,
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  created_at: Timestamp,
  /** The id the client sent with a user message; null on assistant messages. Optional for older responses. */
  client_message_id: z.string().nullable().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const MessageList = z.object({
  messages: z.array(ChatMessage),
});
export type MessageList = z.infer<typeof MessageList>;

export const PostMessageRequest = z.object({
  text: PersonText(4000),
  /**
   * Client-generated per message, so a double submit is idempotent: the same
   * id for the same build returns the stored message (200) and starts no new
   * turn. **Gateway requires it** (400 without); it is optional here only
   * until the portal sends it.
   */
  client_message_id: z.uuid().optional(),
});
export type PostMessageRequest = z.infer<typeof PostMessageRequest>;

/** `POST /v1/builds/:id/messages` → 202 (stored, turn started) or 200 (replayed client_message_id). */
export const PostMessageResponse = z.object({
  message: ChatMessage,
});
export type PostMessageResponse = z.infer<typeof PostMessageResponse>;

/**
 * `GET /v1/builds/:id/events` (text/event-stream). Each event's `data` is one
 * of the payloads below as JSON. Its `id` is an opaque message cursor to send
 * back as `Last-Event-ID`.
 */
export const BUILD_EVENT = {
  messageCreated: "message.created",
  buildUpdated: "build.updated",
} as const;

export const MessageCreatedEvent = z.object({
  message: ChatMessage,
});
export type MessageCreatedEvent = z.infer<typeof MessageCreatedEvent>;

/** Sent on every (re)connect, then whenever status or spec version changes. */
export const BuildUpdatedEvent = z.object({
  status: BuildStatus,
  spec_version: z.number().int().positive().nullable(),
});
export type BuildUpdatedEvent = z.infer<typeof BuildUpdatedEvent>;
