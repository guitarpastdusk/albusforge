# src/components/build/

The build conversation — the landing chat and `/build/[buildId]`.

- `BuildConversation` — context provider holding one conversation. `send()` adds the message optimistically, calls `startBuild` (first message) or `sendBuildMessage` from `src/actions/builds.ts`, and swaps in the server's transcript. After the first message on the landing page the URL becomes `/build/<id>`. `WhenConversationEmpty` shows the landing hero until the chat starts.
- `ConversationView` — the active chat: `ChatBubble`s, `TypingDots` while a reply is pending, the error line, `DesignReadyCard` once the build has a plan, and the sticky reply bar.
- `DesignReadyCard` — "✓ Device design ready", the estimate, part chips from the plan, and the sign-up gate linking to `/signup`.
- `conversation.ts` — the pure reducer the provider uses.

In mock mode the replies are the prototype's script with its 900 ms typing delay (see `src/mocks`); the card appears after the third exchange. Tests in `build.test.tsx`.
