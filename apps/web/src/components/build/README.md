# src/components/build/

The build conversation — the landing chat and `/build/[buildId]`.

- `BuildConversation` — context provider holding one conversation, including the input draft. `send()` adds the message optimistically and calls `startBuild` (first message) or `sendBuildMessage` from `src/actions/builds.ts`; `checkAgain()` calls `checkForReply`. After the first message on the landing page the URL becomes `/build/<id>`. `WhenConversationEmpty` shows the landing hero until the chat starts.
- `ConversationView` — the active chat: `ChatBubble`s, `TypingDots` while a reply is pending, the error line (with "Check for a reply" when a reply timed out), `DesignReadyCard` once the build has a plan, and the sticky reply bar.
- `DesignReadyCard` — "✓ Device design ready", the estimate, part chips from the plan, and the sign-up gate linking to `/signup`.
- `conversation.ts` — the pure reducer, and `runSend` / `runCheck`, which call the actions through `settle()` and never reject.

Failure handling:
- A call that **rejects** (lost connection, aborted dispatch) or returns **`{ ok: false }`**: typing stops, the optimistic bubble is removed, the text goes back into the input, and a retryable message shows.
- A message that was **accepted but whose reply didn't arrive** before the action's 20 s deadline (including a gateway read that hangs): the transcript stays — or, if no read finished, the sent message — and "Check for a reply" reads it again — the message is never resent.

In mock mode the replies are the prototype's script with its 900 ms typing delay (see `src/mocks`); the card appears after the third exchange. Tests in `build.test.tsx`.
