import type { BuildStatus, CandidatePart, ChatMessage, DeviceReadyCard } from "@albusforge/schema";
import type { ActionResult } from "@/lib/action-result";
import { awaitingReply, localMessageId, mergeMessages, type BuildTranscript } from "@/lib/build-transcript";
import { settle } from "@/lib/safe-action";

export type { BuildTranscript };

export interface ConversationState {
  buildId: string | null;
  messages: ChatMessage[];
  ready: DeviceReadyCard | null;
  status: BuildStatus | null;
  specVersion: number | null;
  spec: Record<string, unknown> | null;
  candidateParts: CandidatePart[];
  /** The input's text. Restored when a send fails, so nothing typed is lost. */
  draft: string;
  error: string | null;
  /** Detail reads can fail even after the assistant message has arrived. */
  refreshError: string | null;
  detailsStale: boolean;
  /** Highest spec version observed on the stream, not yet necessarily hydrated. */
  observedSpecVersion: number | null;
  /** A send is on its way to gateway and not yet accepted. */
  sending: boolean;
  /** The reply is past REPLY_CHECK_AFTER_MS: stop the typing dots and offer "Check for a reply" (a refetch, never a resend). */
  overdue: boolean;
  /** The last send that failed. Sending the same text again reuses its client_message_id, so a send that did land isn't duplicated. */
  unsent: { text: string; clientMessageId: string } | null;
}

export type ConversationEvent =
  | { type: "draft"; text: string }
  | { type: "sent"; text: string; at: string; clientMessageId: string }
  /** startBuild succeeded: the new build and its transcript. */
  | { type: "created"; transcript: BuildTranscript }
  /** sendBuildMessage succeeded: gateway's copy of the message. */
  | { type: "accepted"; message: ChatMessage }
  | { type: "failed"; message: string; text: string; clientMessageId: string }
  /** message.created on the event stream. */
  | { type: "messageCreated"; message: ChatMessage }
  /** build.updated on the event stream. */
  | { type: "buildUpdated"; status: BuildStatus; specVersion: number | null }
  | { type: "refreshed"; transcript: BuildTranscript }
  | { type: "refreshRequested" }
  | { type: "refreshFailed"; message: string }
  | { type: "overdue"; message: string }
  /** "Check for a reply": back to waiting, with a fresh clock. */
  | { type: "checking" };

export const OVERDUE_MESSAGE = "The reply is taking longer than usual.";

export function initConversation(initial?: Partial<BuildTranscript>): ConversationState {
  return {
    buildId: initial?.buildId ?? null,
    messages: initial?.messages ?? [],
    ready: initial?.ready ?? null,
    status: initial?.status ?? null,
    specVersion: initial?.specVersion ?? null,
    spec: initial?.spec ?? null,
    candidateParts: initial?.candidateParts ?? [],
    draft: "",
    error: null,
    refreshError: null,
    detailsStale: false,
    observedSpecVersion: initial?.specVersion ?? null,
    sending: false,
    overdue: false,
    unsent: null,
  };
}

/** Waiting for a reply and not yet overdue: show the typing dots, and don't take another send. */
export const isTyping = (state: ConversationState): boolean => awaitingReply(state.messages) && !state.overdue;

const withTranscript = (state: ConversationState, transcript: BuildTranscript): ConversationState => {
  const merged = { ...state, buildId: transcript.buildId, messages: mergeMessages(state.messages, transcript.messages) };
  // A stream event can announce a newer version while a detail read is in flight.
  if ((transcript.specVersion ?? 0) < (state.observedSpecVersion ?? 0)) return merged;
  return {
    ...merged,
    ready: transcript.ready,
    status: transcript.status,
    specVersion: transcript.specVersion,
    spec: transcript.spec,
    candidateParts: transcript.candidateParts,
    observedSpecVersion: transcript.specVersion,
    detailsStale: false,
    refreshError: null,
  };
};

/** A reply arrived (or nothing is pending): clear the overdue offer and its message. */
const settleOverdue = (state: ConversationState): ConversationState =>
  state.overdue && !awaitingReply(state.messages) ? { ...state, overdue: false, error: null } : state;

export function conversationReducer(state: ConversationState, event: ConversationEvent): ConversationState {
  switch (event.type) {
    case "draft":
      return { ...state, draft: event.text };
    case "sent":
      return {
        ...state,
        sending: true,
        error: null,
        draft: "",
        overdue: false,
        messages: [
          ...state.messages,
          { id: localMessageId(event.clientMessageId), role: "user", text: event.text, created_at: event.at, client_message_id: event.clientMessageId },
        ],
      };
    case "created":
      return settleOverdue({ ...withTranscript(state, event.transcript), sending: false, unsent: null });
    case "accepted":
      return settleOverdue({ ...state, sending: false, unsent: null, messages: mergeMessages(state.messages, [event.message]) });
    case "failed":
      // The message never landed: drop the optimistic bubble and give the text back.
      return {
        ...state,
        sending: false,
        error: event.message,
        messages: state.messages.filter((message) => message.id !== localMessageId(event.clientMessageId)),
        draft: state.draft || event.text,
        unsent: { text: event.text, clientMessageId: event.clientMessageId },
      };
    case "messageCreated":
      return settleOverdue({ ...state, messages: mergeMessages(state.messages, [event.message]) });
    case "buildUpdated":
      return {
        ...state, status: event.status,
        observedSpecVersion: Math.max(state.observedSpecVersion ?? 0, event.specVersion ?? 0) || null,
        detailsStale: state.detailsStale || event.specVersion !== state.specVersion || event.status !== state.status,
      };
    case "refreshRequested":
      return { ...state, detailsStale: true, refreshError: null };
    case "refreshed":
      return settleOverdue(withTranscript(state, event.transcript));
    case "refreshFailed":
      return { ...state, refreshError: event.message, detailsStale: true, overdue: awaitingReply(state.messages) };
    case "overdue":
      return awaitingReply(state.messages) ? { ...state, overdue: true, error: event.message } : state;
    case "checking":
      return { ...state, overdue: false, error: null };
  }
}

export interface ConversationActions {
  startBuild(askText: string, clientMessageId: string): Promise<ActionResult<BuildTranscript>>;
  sendBuildMessage(buildId: string, text: string, clientMessageId: string): Promise<ActionResult<{ message: ChatMessage }>>;
  refreshBuild(buildId: string): Promise<ActionResult<BuildTranscript>>;
}

type Dispatch = (event: ConversationEvent) => void;

/** The client_message_id for a send: the failed send's again for the same text (idempotent if it did land), else a new one. */
export function clientMessageIdFor(unsent: ConversationState["unsent"], text: string, newId: () => string): string {
  return unsent && unsent.text === text ? unsent.clientMessageId : newId();
}

/** Send one message and dispatch the outcome. Never rejects. Returns the transcript when this send created the build. */
export async function runSend(
  buildId: string | null,
  text: string,
  clientMessageId: string,
  actions: ConversationActions,
  dispatch: Dispatch,
): Promise<BuildTranscript | null> {
  if (!buildId) {
    const result = await settle(() => actions.startBuild(text, clientMessageId));
    if (result.ok) {
      dispatch({ type: "created", transcript: result.data });
      return result.data;
    }
    dispatch({ type: "failed", message: result.message, text, clientMessageId });
    return null;
  }
  const result = await settle(() => actions.sendBuildMessage(buildId, text, clientMessageId));
  if (result.ok) dispatch({ type: "accepted", message: result.data.message });
  else dispatch({ type: "failed", message: result.message, text, clientMessageId });
  return null;
}
