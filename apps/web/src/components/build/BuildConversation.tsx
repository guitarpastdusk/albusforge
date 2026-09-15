"use client";

import { BUILD_EVENT, BuildUpdatedEvent, MessageCreatedEvent } from "@albusforge/schema";
import { createContext, useContext, useReducer, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { useWorkspaceTransition } from "@/components/shell/WorkspaceBoundary";
import { refreshBuild, sendBuildMessage, startBuild } from "@/actions/builds";
import { loadEnclosureBody } from "@/actions/enclosure";
import { ENCLOSURE_SAMPLE, type EnclosurePreviewData } from "@/components/enclosure/fixture";
import { useEventStream, type StreamState } from "@/lib/sse/useEventStream";
import {
  clientMessageIdFor,
  conversationReducer,
  initConversation,
  isTyping,
  OVERDUE_MESSAGE,
  UNSENT_MESSAGE,
  runSend,
  type BuildTranscript,
  type ConversationActions,
  type ConversationState,
} from "./conversation";
import { useReplyWatchdog } from "./useReplyWatchdog";
import { useBuildRefresh } from "./useBuildRefresh";
import { useEnclosureBody } from "./useEnclosureBody";

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
  /** The device-ready card's 3D enclosure preview: the build's body (GET /v1/builds/:id/body) once it has one, the labelled sample until then, null to show none. */
  enclosurePreview: EnclosurePreviewData | null;
  /** The body read failed (not "no body yet"): the card says so instead of showing the sample, and offers a retry. */
  enclosureError: string | null;
  retryEnclosure: () => void;
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
  enclosurePreview: fallbackPreview = ENCLOSURE_SAMPLE,
  loadBody = loadEnclosureBody,
  children,
}: {
  initial?: BuildTranscript;
  /** Text waiting in the input before the first send: a Marketplace clone (lib/clone-ask.ts). */
  initialDraft?: string;
  signedIn?: boolean | Promise<boolean>;
  /** What the card shows until the build has a body: the labelled sample by default, null for no preview. */
  enclosurePreview?: EnclosurePreviewData | null;
  /** Reads the build's body once the card is due; tests substitute it. */
  loadBody?: (buildId: string) => Promise<ActionResult<EnclosurePreviewData | null>>;
  children: ReactNode;
}) {
  const workspace = useWorkspaceTransition();
  const [state, dispatch] = useReducer(conversationReducer, initial, (transcript) => initConversation(transcript, initialDraft));
  const typing = isTyping(state);
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const { buildId } = state;
  const { preview: enclosurePreview, error: enclosureError, retry: retryEnclosure } = useEnclosureBody(buildId, state.ready !== null, fallbackPreview, loadBody);
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

  /*
   * Chase a reply that hasn't arrived, automatically and then by hand.
   *
   * A refetch, never a resend: gateway starts a fresh turn whenever it reads a
   * transcript whose last message is an unanswered one, so this is what makes
   * a lost turn recover — and nothing the person wrote can be duplicated by it.
   *
   * With no build id there is nothing to read: the send that would have
   * created the build is still in flight or has been lost, and only the person
   * can decide to send again, so `checks` just moves the state along to the
   * message that says so.
   */
  const checkAgain = () => {
    dispatch({ type: "checking" });
    if (buildId) requestRefresh(buildId, state.observedSpecVersion);
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

  // Armed by waiting, not by having a build id: the first message from the
  // landing page is the one most likely to be left hanging, and it is waiting
  // before a build exists to read.
  useReplyWatchdog(
    typing,
    () => checkAgain(),
    () => dispatch({ type: "overdue", message: buildId ? OVERDUE_MESSAGE : UNSENT_MESSAGE }),
  );

  return (
    <ConversationContext value={{ state, signedIn, typing, send, setDraft, checkAgain, enclosurePreview, enclosureError, retryEnclosure, streamState }}>
      {children}
    </ConversationContext>
  );
}

/** Renders its children only while the conversation hasn't started — the landing hero. */
export function WhenConversationEmpty({ children }: { children: ReactNode }) {
  const { state } = useConversation();
  return state.messages.length === 0 ? children : null;
}
