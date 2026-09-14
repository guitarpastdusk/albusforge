"use client";

import { BUILD_EVENT, BuildUpdatedEvent, MessageCreatedEvent } from "@albusforge/schema";
import { createContext, useContext, useReducer, useState, type ReactNode } from "react";
import { useWorkspaceTransition } from "@/components/shell/WorkspaceBoundary";
import { refreshBuild, sendBuildMessage, startBuild } from "@/actions/builds";
import type { EnclosurePreviewData } from "@/components/enclosure/fixture";
import { useEventStream, type StreamState } from "@/lib/sse/useEventStream";
import {
  clientMessageIdFor,
  conversationReducer,
  initConversation,
  isTyping,
  OVERDUE_MESSAGE,
  runSend,
  type BuildTranscript,
  type ConversationActions,
  type ConversationState,
} from "./conversation";
import { useReplyWatchdog } from "./useReplyWatchdog";
import { useBuildRefresh } from "./useBuildRefresh";

const ACTIONS: ConversationActions = { startBuild, sendBuildMessage, refreshBuild };

/** Event payloads that don't match the contract are dropped. */
const PARSE_EVENT = {
  [BUILD_EVENT.messageCreated]: (data: unknown) => MessageCreatedEvent.safeParse(data).data,
  [BUILD_EVENT.buildUpdated]: (data: unknown) => BuildUpdatedEvent.safeParse(data).data,
};
const EVENTS = [BUILD_EVENT.messageCreated, BUILD_EVENT.buildUpdated];

interface ConversationApi {
  state: ConversationState;
  /** Waiting for a reply and not yet overdue: typing dots, and no new send. */
  typing: boolean;
  signedIn: boolean | Promise<boolean>;
  /** The device-ready card's 3D enclosure preview: the fixture in mock mode, a labelled sample in live mode, null to show none. */
  enclosurePreview: EnclosurePreviewData | null;
  /** The event stream's state, once a build exists; null before. The view says when replies may be delayed. */
  streamState: StreamState | null;
  /** Send a message; the first one creates the build. False if nothing was sent. */
  send: (text: string) => boolean;
  setDraft: (text: string) => void;
  /** After a reply is overdue: read the build again. Never resends. */
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
 *
 * Replies and spec progress arrive on GET /v1/builds/:id/events (same-origin,
 * so the anonymous owner cookie goes with it). Messages are merged by id, so
 * the transcript a fresh connection replays is harmless. A reply that takes
 * past REPLY_CHECK_AFTER_MS turns into "Check for a reply".
 */
export function BuildConversation({
  initial,
  initialDraft = "",
  signedIn = false,
  enclosurePreview = null,
  children,
}: {
  initial?: BuildTranscript;
  /** Text waiting in the input before the first send: a Marketplace clone (lib/clone-ask.ts). */
  initialDraft?: string;
  signedIn?: boolean | Promise<boolean>;
  enclosurePreview?: EnclosurePreviewData | null;
  children: ReactNode;
}) {
  const workspace = useWorkspaceTransition();
  const [state, dispatch] = useReducer(conversationReducer, initial, (transcript) => initConversation(transcript, initialDraft));
  const typing = isTyping(state);
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const { buildId } = state;
  const requestRefresh = useBuildRefresh(ACTIONS, dispatch);

  const send = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed || state.sending || typing || (workspace && (workspace.blocked || workspace.expectedTenant === undefined))) return false;

    const clientMessageId = clientMessageIdFor(state.unsent, trimmed, () => crypto.randomUUID());
    dispatch({ type: "sent", text: trimmed, at: new Date().toISOString(), clientMessageId });
    void runSend(buildId, trimmed, clientMessageId, { ...ACTIONS, startBuild: (text, id) => startBuild(text, id, workspace?.expectedTenant) }, dispatch).then((transcript) => {
      if (!buildId && transcript) window.history.replaceState(null, "", `/build/${encodeURIComponent(transcript.buildId)}`);
    });
    return true;
  };

  const checkAgain = () => {
    if (!buildId) return;
    dispatch({ type: "checking" });
    requestRefresh(buildId, state.observedSpecVersion);
  };

  const setDraft = (text: string) => dispatch({ type: "draft", text });

  useEventStream(buildId ? `/v1/builds/${encodeURIComponent(buildId)}/events` : null, {
    events: EVENTS,
    parse: PARSE_EVENT,
    onEvent: (type, data) => {
      if (!buildId) return;
      if (type === BUILD_EVENT.messageCreated) {
        dispatch({ type: "messageCreated", message: (data as MessageCreatedEvent).message });
        return;
      }
      const update = data as BuildUpdatedEvent;
      const changed = update.status !== state.status || update.spec_version !== state.specVersion;
      dispatch({ type: "buildUpdated", status: update.status, specVersion: update.spec_version });
      // A new spec version or status: read the detail for the spec, candidate parts and ready card.
      if (changed) requestRefresh(buildId, update.spec_version);
    },
    // A fresh connection may have missed a spec change: read the build once.
    onOpen: () => {
      if (buildId) requestRefresh(buildId, state.observedSpecVersion);
    },
    onState: setStreamState,
  });

  useReplyWatchdog(Boolean(buildId) && typing, () => dispatch({ type: "overdue", message: OVERDUE_MESSAGE }));

  return <ConversationContext value={{ state, signedIn, typing, send, setDraft, checkAgain, enclosurePreview, streamState }}>{children}</ConversationContext>;
}

/** Renders its children only while the conversation hasn't started — the landing hero. */
export function WhenConversationEmpty({ children }: { children: ReactNode }) {
  const { state } = useConversation();
  return state.messages.length === 0 ? children : null;
}
