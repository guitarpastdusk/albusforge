# src/app/

Routes (Next.js App Router). Route-segment folders don't carry their own README — this table is the map.

| Route | Screen | Auth | State |
| --- | --- | --- | --- |
| `/` | Landing — chat-first, device carousel | anonymous | empty state pixel-faithful; submit is a TODO |
| `/build/[buildId]` | Active build conversation | anonymous until checkout | stub: renders messages |
| `(auth)/signup`, `(auth)/signin` | Email → 6-digit code → done | — | stub |
| `(app)/projects` | Projects grid | session | stub with real data path |
| `(app)/projects/[buildId]` | Track kit / review parts (not designed yet) | session | stub |
| `(app)/live` | Live systems — fleet | session | stub |
| `(app)/live/[deviceId]` | Device dashboard + device chat | session | stub: lists derived widgets |
| `(app)/usage` | Usage for the current period (not in the header nav) | session | stub |
| `/marketplace`, `/marketplace/[listingId]` | Community builds | public | stub |
| `(static)/docs`, `pricing`, `security` | Footer pages | public | placeholder |

`error.tsx` is the root error boundary: it renders `ServiceUnavailable` inside the root layout (header and footer stay) for any page below it. `global-error.tsx` replaces the layout if the layout itself fails. `fonts.ts` holds the next/font loaders both use.

`(app)/layout.tsx` is where the session guard goes. Every page that fetches is rendered per request (the API client calls `connection()`), so no data is baked in at build time.
