# src/components/shell/

- `Header.tsx` — logo, nav pills (active from the pathname; `/live/*` lights Live systems, `/build/*` lights Build), and either Sign in + Get started or the avatar, email and Sign out. Projects and Live systems show only with a session. Below `lg` the nav and account move into a menu behind one button (`aria-expanded`, Escape closes and returns focus; the full email wraps inside it), so the header never scrolls the page sideways; from `lg` up it is the design's header unchanged. A client component because it reads the pathname and holds the menu state.
- `SessionHeader.tsx` — Server Component that reads the session (`getHeaderSession`, `lib/session.ts`) and renders `Header`; the root layout streams it inside `<Suspense>`, with a `pending` header as the fallback. A gateway failure shows the header signed out (logged once) rather than failing the page.
- `Footer.tsx` — tagline and the About us / Docs / Pricing / Security pledge links.
