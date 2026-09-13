"use client";

import { createContext, useContext, useReducer, type ReactNode } from "react";
import { sendBuildMessage, startBuild } from "@/actions/builds";
import { conversationReducer, initConversation, type BuildTranscript, type ConversationState } from "./conversation";

interface ConversationApi {
  state: ConversationState;
  /** Send a message; the first one creates the build. False if nothing was sent. */
  send: (text: string) => boolean;
}

const ConversationContext = createContext<ConversationApi | null>(null);

export function useConversation(): ConversationApi {
  const api = useContext(ConversationContext);
  if (!api) throw new Error("useConversation must be used inside <BuildConversation>");
  return api;
}

/**
 * Holds one build conversation. The landing page starts it empty (the first
 * send creates the build); /build/[buildId] starts it from the server's
 * transcript. Once a landing conversation has a build, the URL becomes
 * /build/<id> so a refresh or a shared link reopens it.
 */
export function BuildConversation({ initial, children }: { initial?: BuildTranscript; children: ReactNode }) {
  const [state, dispatch] = useReducer(conversationReducer, initial, initConversation);

  const send = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed || state.typing) return false;

    dispatch({ type: "sent", text: trimmed, at: new Date().toISOString() });
    const { buildId } = state;
    void (async () => {
      const result = buildId ? await sendBuildMessage(buildId, trimmed) : await startBuild(trimmed);
      if (!result.ok) return dispatch({ type: "failed", message: result.message });
      dispatch({ type: "replied", transcript: result.data });
      if (!buildId) window.history.replaceState(null, "", `/build/${encodeURIComponent(result.data.buildId)}`);
    })();
    return true;
  };

  return <ConversationContext value={{ state, send }}>{children}</ConversationContext>;
}

/** Renders its children only while the conversation hasn't started — the landing hero. */
export function WhenConversationEmpty({ children }: { children: ReactNode }) {
  const { state } = useConversation();
  return state.messages.length === 0 ? children : null;
}
