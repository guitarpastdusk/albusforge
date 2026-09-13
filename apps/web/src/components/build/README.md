# src/components/build/

The build conversation — the landing chat and `/build/[buildId]`.

- `BuildConversation` — context provider holding one conversation, including the input draft. `send()` adds the message optimistically with a `client_message_id` and calls `startBuild` (first message) or `sendBuildMessage` from `src/actions/builds.ts`. It subscribes to `GET /v1/builds/:id/events` (`useEventStream`): `message.created` merges messages by id, and `build.updated` with a changed status or spec version, or a (re)opened stream, reads the build again (`refreshBuild`). `useReplyWatchdog` turns a reply that takes past 60 s into "Check for a reply". After the first message on the landing page the URL becomes `/build/<id>`. `WhenConversationEmpty` shows the landing hero until the chat starts.
- `ConversationView` — the active chat: `ChatBubble`s, `TypingDots` while a reply is due, the error line (with "Check for a reply" once overdue), `SpecPanel`, `CandidateParts`, `DesignReadyCard` once the build has a plan, and the sticky reply bar.
- `SpecPanel` — the spec so far (senses, where, connectivity, power, alerts), what's still to decide, and assumptions. Derives a defensive draft parser from the shared `Spec` field schemas; malformed sections are left out and capability IDs are shown.
- `ProjectOverview` — authenticated project detail with stored spec/version, candidate matches, supplied ready summary, resume-conversation action and explicit unavailable artifact/fulfillment states.
- `CandidateParts` — registry parts matching the spec's capabilities, labelled as a match, not a plan.
- `useReplyWatchdog` — calls back once if a reply stays due for 60 s.
- `DesignReadyCard` — "✓ Device design ready", the estimate, part chips from the plan, and a session-aware action: signed-in visitors open the current project, while anonymous visitors sign up with that project preserved in `next`.
- `SessionReadyCard` — resolves the server’s boolean session promise in its own Suspense boundary, with a safe signup fallback; session latency never blocks public hero/chat rendering.
- `conversation.ts` — the pure reducer, `runSend` (through `settle()`, never rejects) and `clientMessageIdFor` (a failed send's id is reused when the same text is sent again). Tracks the stream's observed spec version separately from the version whose details have loaded.
- `useBuildRefresh` — reads the detail after stream opens, spec/status changes and manual checks. A failed read or one older than the observed spec retries after 1 s and 2 s; after that, an independent “Refresh build details” action remains available even if the assistant reply has arrived. A new request cancels old retry timers and ignores superseded results; unmount cancels the remaining work.

Failure handling:
- A send that **rejects** (lost connection, aborted dispatch) or returns **`{ ok: false }`** (including 409 `TURN_IN_PROGRESS` and 429 `RATE_LIMITED`): the optimistic bubble is removed, the text goes back into the input, and a retryable message shows. Sending the same text again reuses its `client_message_id`, so a send that did land isn't duplicated.
- A reply that hasn't arrived after **60 s**: the typing dots stop and "Check for a reply" reads the build again (gateway restarts a lost turn on that read). The message is never resent.
- Detail freshness is independent of reply timing: “Updating build details…” remains until the observed version is hydrated, or the bounded retries finish with a visible refresh error. Arrival of an assistant message does not clear that error. Refreshing details never sends another message.

In mock mode the replies are the prototype's script, about 1.5 s after each message, streamed by the dev route handler (`src/mocks`); the card appears after the third exchange. Tests in `build.test.tsx`, `build-refresh.test.tsx`, `useReplyWatchdog.test.tsx` and `src/actions/actions.test.ts`.
