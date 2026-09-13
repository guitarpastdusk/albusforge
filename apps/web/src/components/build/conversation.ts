import type { ChatMessage, DeviceReadyCard } from "@albusforge/schema";
import type { BuildTranscript, ConversationResult } from "@/lib/build-transcript";
import { settle } from "@/lib/safe-action";

export type { BuildTranscript, ConversationResult };

export interface ConversationState {
  buildId: string | null;
  messages: ChatMessage[];
  /** A reply is pending: show the typing dots, don't accept another send. */
  typing: boolean;
  ready: DeviceReadyCard | null;
  error: string | null;
  /** The input's text. Restored when a send fails, so nothing typed is lost. */
  draft: string;
  /** The last message was accepted but its reply hasn't arrived: offer to check again, never to resend. */
  awaitingReply: boolean;
}

export type ConversationEvent =
  | { type: "draft"; text: string }
  | { type: "sent"; text: string; at: string }
  | { type: "checking" }
  | { type: "replied"; transcript: BuildTranscript }
  | { type: "stalled"; message: string; transcript: BuildTranscript }
  | { type: "failed"; message: string; text: string };

export function initConversation(initial?: Partial<BuildTranscript>): ConversationState {
  return {
    buildId: initial?.buildId ?? null,
    messages: initial?.messages ?? [],
    typing: false,
    ready: initial?.ready ?? null,
    error: null,
    draft: "",
    awaitingReply: false,
  };
}

const LOCAL = "local-";

export function conversationReducer(state: ConversationState, event: ConversationEvent): ConversationState {
  switch (event.type) {
    case "draft":
      return { ...state, draft: event.text };
    case "sent":
      return {
        ...state,
        typing: true,
        error: null,
        draft: "",
        awaitingReply: false,
        messages: [...state.messages, { id: `${LOCAL}${state.messages.length + 1}`, role: "user", text: event.text, created_at: event.at }],
      };
    case "checking":
      return { ...state, typing: true, error: null };
    case "replied":
      // The server's transcript replaces the optimistic copy.
      return {
        ...state,
        typing: false,
        error: null,
        awaitingReply: false,
        buildId: event.transcript.buildId,
        messages: event.transcript.messages,
        ready: event.transcript.ready,
      };
    case "stalled":
      return {
        ...state,
        typing: false,
        error: event.message,
        awaitingReply: true,
        buildId: event.transcript.buildId,
        messages: event.transcript.messages,
        ready: event.transcript.ready,
      };
    case "failed":
      // The message never landed: drop the optimistic bubble and give the text back.
      return {
        ...state,
        typing: false,
        error: event.message,
        messages: state.messages.filter((message) => !message.id.startsWith(LOCAL)),
        draft: state.draft || event.text,
      };
  }
}

export interface ConversationActions {
  startBuild(askText: string): Promise<ConversationResult>;
  sendBuildMessage(buildId: string, text: string): Promise<ConversationResult>;
  checkForReply(buildId: string, sinceAssistantCount: number): Promise<ConversationResult>;
}

type Dispatch = (event: ConversationEvent) => void;

/** Send one message and dispatch the outcome. Never rejects. Returns the transcript when the build exists. */
export async function runSend(
  buildId: string | null,
  text: string,
  actions: ConversationActions,
  dispatch: Dispatch,
): Promise<BuildTranscript | null> {
  const result = await settle(() => (buildId ? actions.sendBuildMessage(buildId, text) : actions.startBuild(text)));
  if (result.ok) {
    dispatch({ type: "replied", transcript: result.data });
    return result.data;
  }
  if ("awaitingReply" in result && result.awaitingReply) {
    dispatch({ type: "stalled", message: result.message, transcript: result.awaitingReply });
    return result.awaitingReply;
  }
  dispatch({ type: "failed", message: result.message, text });
  return null;
}

/** Check again for a reply that timed out. Never rejects; a failure keeps the check-again state. */
export async function runCheck(
  buildId: string,
  sinceAssistantCount: number,
  actions: ConversationActions,
  dispatch: Dispatch,
): Promise<void> {
  dispatch({ type: "checking" });
  const result = await settle(() => actions.checkForReply(buildId, sinceAssistantCount));
  if (result.ok) dispatch({ type: "replied", transcript: result.data });
  else if ("awaitingReply" in result && result.awaitingReply) dispatch({ type: "stalled", message: result.message, transcript: result.awaitingReply });
  else dispatch({ type: "failed", message: result.message, text: "" });
}
