# src/components/build/

The build conversation — the landing chat and `/build/[buildId]`.

- `BuildConversation` — context provider holding one conversation, including the input draft. `send()` adds the message optimistically with a `client_message_id` and calls `startBuild` (first message) or `sendBuildMessage` from `src/actions/builds.ts`. It subscribes to `GET /v1/builds/:id/events` (`useEventStream`): `message.created` merges messages by id, and `build.updated` with a changed status or spec version, or a (re)opened stream, reads the build again (`refreshBuild`). `useReplyWatchdog` turns a reply that takes past 60 s into "Check for a reply". After the first message on the landing page the URL becomes `/build/<id>`. `WhenConversationEmpty` shows the landing hero until the chat starts.
- `ConversationView` — the active chat: `ChatBubble`s, `TypingDots` while a reply is due, the error line (with "Check for a reply" once overdue), `SpecPanel`, `CandidateParts`, `DesignReadyCard` once the build has a plan, and the sticky reply bar.
- `SpecPanel` — the spec so far (senses, where, connectivity, power, alerts), what's still to decide, and assumptions. Parses a draft of intake's spec shape defensively: fields that don't match are left out.
- `CandidateParts` — registry parts matching the spec's capabilities, labelled as a match, not a plan.
- `useReplyWatchdog` — calls back once if a reply stays due for 60 s.
- `DesignReadyCard` — "✓ Device design ready", the estimate, part chips from the plan, and the sign-up gate linking to `/signup`.
- `conversation.ts` — the pure reducer, `runSend` / `runRefresh` (through `settle()`, never reject) and `clientMessageIdFor` (a failed send's id is reused when the same text is sent again).

Failure handling:
- A send that **rejects** (lost connection, aborted dispatch) or returns **`{ ok: false }`** (including 409 `TURN_IN_PROGRESS` and 429 `RATE_LIMITED`): the optimistic bubble is removed, the text goes back into the input, and a retryable message shows. Sending the same text again reuses its `client_message_id`, so a send that did land isn't duplicated.
- A reply that hasn't arrived after **60 s**: the typing dots stop and "Check for a reply" reads the build again (gateway restarts a lost turn on that read). The message is never resent.

In mock mode the replies are the prototype's script, about 1.5 s after each message, streamed by the dev route handler (`src/mocks`); the card appears after the third exchange. Tests in `build.test.tsx`, `useReplyWatchdog.test.tsx` and `src/actions/actions.test.ts`.
