import type { BuildDetail, BuildStatus, CandidatePart, ChatMessage, DeviceReadyCard } from "@albusforge/schema";

/** One build conversation as the UI holds it: the messages, and what intake has worked out so far. */
export interface BuildTranscript {
  buildId: string;
  messages: ChatMessage[];
  /** The device-ready card, once the plan is solved. */
  ready: DeviceReadyCard | null;
  status: BuildStatus | null;
  specVersion: number | null;
  /** The latest spec as intake wrote it. Its shape isn't in the shared schema yet: parse before use (SpecPanel). */
  spec: Record<string, unknown> | null;
  /** A capability match against the spec, not a solved plan. */
  candidateParts: CandidatePart[];
}

export function transcriptFrom(detail: BuildDetail, messages: ChatMessage[]): BuildTranscript {
  return {
    buildId: detail.id,
    messages,
    ready: detail.ready,
    status: detail.status ?? null,
    specVersion: detail.spec_version ?? null,
    spec: detail.spec ?? null,
    candidateParts: detail.candidate_parts ?? [],
  };
}

/** An optimistic user message, shown before gateway confirms it: `local-<client_message_id>`. */
export const LOCAL_MESSAGE_PREFIX = "local-";

export const localMessageId = (clientMessageId: string) => `${LOCAL_MESSAGE_PREFIX}${clientMessageId}`;

/**
 * Merge messages from gateway (a POST response, an event, a refetch) into
 * what the UI shows. Unique by id, so a replayed event is a no-op; a server
 * message replaces the optimistic copy with the same client_message_id;
 * confirmed messages are ordered by created_at, and optimistic ones stay last.
 */
export function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) {
    if (message.client_message_id) byId.delete(localMessageId(message.client_message_id));
    byId.set(message.id, message);
  }
  const all = [...byId.values()];
  const confirmed = all
    .filter((message) => !message.id.startsWith(LOCAL_MESSAGE_PREFIX))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return [...confirmed, ...all.filter((message) => message.id.startsWith(LOCAL_MESSAGE_PREFIX))];
}

/** The last message is the visitor's: a reply is due. */
export const awaitingReply = (messages: readonly ChatMessage[]): boolean => messages.at(-1)?.role === "user";
