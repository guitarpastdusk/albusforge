import { z } from "zod";
import { Accent, Id, Timestamp } from "./common";

/**
 * What the Projects screen shows. Derived server-side from build status and
 * order status together — the portal never reconstructs it.
 */
export const DisplayStatus = z.enum(["designing", "parts_picked", "kit_shipped", "live"]);
export type DisplayStatus = z.infer<typeof DisplayStatus>;

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

export const BuildDetail = BuildSummary.extend({
  /** Present once the plan is solved; null while the conversation is still going. */
  ready: DeviceReadyCard.nullable(),
});
export type BuildDetail = z.infer<typeof BuildDetail>;

export const CreateBuildRequest = z.object({
  ask_text: z.string().trim().min(1).max(2000),
});
export type CreateBuildRequest = z.infer<typeof CreateBuildRequest>;

export const CreateBuildResponse = z.object({
  build_id: Id,
  status: z.string(),
});
export type CreateBuildResponse = z.infer<typeof CreateBuildResponse>;

export const ChatMessage = z.object({
  id: Id,
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  created_at: Timestamp,
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const MessageList = z.object({
  messages: z.array(ChatMessage),
});
export type MessageList = z.infer<typeof MessageList>;

export const PostMessageRequest = z.object({
  text: z.string().trim().min(1).max(4000),
});
export type PostMessageRequest = z.infer<typeof PostMessageRequest>;
