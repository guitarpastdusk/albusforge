# src/app/

Routes (Next.js App Router). Route-segment folders don't carry their own README — this table is the map.

| Route | Screen | Auth | State |
| --- | --- | --- | --- |
| `/` | Landing — chat-first, device carousel; the chat starts in place | anonymous | built to design |
| `/build/[buildId]` | The same conversation, reopened from its URL | anonymous until checkout | built to design |
| `(auth)/signup`, `(auth)/signin` | Email → 6-digit code → done | — | built to design |
| `(app)/projects` | Projects grid | session | built to design |
| `(app)/projects/[buildId]` | Track kit / review parts (not designed yet) | session | stub |
| `(app)/live` | Live systems — fleet | session | built to design |
| `(app)/live/[deviceId]` | Device dashboard: widgets from config, closed-loop actions, device chat | session | built to design |
| `(app)/usage` | Usage for the current period (not in the header nav) | session | stub |
| `/marketplace` | Community builds; `?category=` filters in gateway, `?cursor=` pages | public | built to design |
| `/marketplace/[listingId]` | A listing (not designed yet) | public | stub |
| `(static)/docs`, `pricing`, `security` | Footer pages | public | placeholder |

`error.tsx` is the root error boundary: it renders `ServiceUnavailable` inside the root layout (header and footer stay) for any page below it. `global-error.tsx` replaces the layout if the layout itself fails. `fonts.ts` holds the next/font loaders both use.

Interactive writes (chat, device questions, sign-in) go through Server Functions in [`src/actions`](../actions/).

`(app)/layout.tsx` is where the session guard goes. Every page that fetches is rendered per request (the API client calls `connection()`), so no data is baked in at build time.
