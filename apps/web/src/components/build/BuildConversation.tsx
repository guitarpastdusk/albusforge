"use client";

import { createContext, useContext, useReducer, type ReactNode } from "react";
import { checkForReply, sendBuildMessage, startBuild } from "@/actions/builds";
import type { EnclosurePreviewData } from "@/components/enclosure/fixture";
import { assistantCount } from "@/lib/build-transcript";
import {
  conversationReducer,
  initConversation,
  runCheck,
  runSend,
  type BuildTranscript,
  type ConversationActions,
  type ConversationState,
} from "./conversation";

const ACTIONS: ConversationActions = { startBuild, sendBuildMessage, checkForReply };

interface ConversationApi {
  state: ConversationState;
  /** The device-ready card's 3D enclosure preview: the fixture in mock mode, null in live mode. */
  enclosurePreview: EnclosurePreviewData | null;
  /** Send a message; the first one creates the build. False if nothing was sent. */
  send: (text: string) => boolean;
  setDraft: (text: string) => void;
  /** After a reply timed out: read the transcript again rather than resending. */
  checkAgain: () => void;
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
export function BuildConversation({
  initial,
  enclosurePreview = null,
  children,
}: {
  initial?: BuildTranscript;
  enclosurePreview?: EnclosurePreviewData | null;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(conversationReducer, initial, initConversation);

  const send = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed || state.typing) return false;

    dispatch({ type: "sent", text: trimmed, at: new Date().toISOString() });
    const { buildId } = state;
    void runSend(buildId, trimmed, ACTIONS, dispatch).then((transcript) => {
      if (!buildId && transcript) window.history.replaceState(null, "", `/build/${encodeURIComponent(transcript.buildId)}`);
    });
    return true;
  };

  const checkAgain = () => {
    if (!state.buildId || state.typing) return;
    void runCheck(state.buildId, assistantCount(state.messages), ACTIONS, dispatch);
  };

  const setDraft = (text: string) => dispatch({ type: "draft", text });

  return <ConversationContext value={{ state, send, setDraft, checkAgain, enclosurePreview }}>{children}</ConversationContext>;
}

/** Renders its children only while the conversation hasn't started — the landing hero. */
export function WhenConversationEmpty({ children }: { children: ReactNode }) {
  const { state } = useConversation();
  return state.messages.length === 0 ? children : null;
}
