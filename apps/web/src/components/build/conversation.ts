import type { ChatMessage, DeviceReadyCard } from "@albusforge/schema";

/** What the build Server Functions return: the whole transcript and the ready card, if any. */
export interface BuildTranscript {
  buildId: string;
  messages: ChatMessage[];
  ready: DeviceReadyCard | null;
}

export interface ConversationState {
  buildId: string | null;
  messages: ChatMessage[];
  /** The assistant is replying: show the typing dots, don't accept another send. */
  typing: boolean;
  ready: DeviceReadyCard | null;
  error: string | null;
}

export type ConversationEvent =
  | { type: "sent"; text: string; at: string }
  | { type: "replied"; transcript: BuildTranscript }
  | { type: "failed"; message: string };

export function initConversation(initial?: Partial<BuildTranscript>): ConversationState {
  return {
    buildId: initial?.buildId ?? null,
    messages: initial?.messages ?? [],
    typing: false,
    ready: initial?.ready ?? null,
    error: null,
  };
}

export function conversationReducer(state: ConversationState, event: ConversationEvent): ConversationState {
  switch (event.type) {
    case "sent":
      return {
        ...state,
        typing: true,
        error: null,
        messages: [
          ...state.messages,
          { id: `local-${state.messages.length + 1}`, role: "user", text: event.text, created_at: event.at },
        ],
      };
    case "replied":
      // The server's transcript replaces the optimistic copy.
      return {
        ...state,
        typing: false,
        error: null,
        buildId: event.transcript.buildId,
        messages: event.transcript.messages,
        ready: event.transcript.ready,
      };
    case "failed":
      return { ...state, typing: false, error: event.message };
  }
}
