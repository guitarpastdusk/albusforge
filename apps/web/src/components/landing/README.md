# src/components/landing/

`ChatStart` — the landing page's chat input card and three starter chips. Submitting (or clicking a chip) calls the surrounding `BuildConversation`'s `send()`, which creates the build (`POST /v1/builds`) and switches the page to the active chat in place — see [`../build/`](../build/).
