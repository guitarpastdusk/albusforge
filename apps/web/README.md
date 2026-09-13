# apps/web/

The portal — Next.js App Router, React 19, Tailwind CSS v4. Deployed as the Cloud Run service `web`, which the load balancer sends every path except `/v1/*` to, on the apex and on every tenant subdomain ([ADR 0007](../../docs/adr/0007-portal-routing.md)).

The design reference is the Albusforge.ai website handoff (high fidelity); its tokens live in [`src/styles/tokens.css`](src/styles/tokens.css).

## Run it

```sh
pnpm install
pnpm dev            # http://localhost:3000, API_MODE=mock by default
```

`pnpm --filter web test | lint | typecheck | build` run one check; the root scripts run all of them through turbo.

## Data

All data goes through [`src/lib/api`](src/lib/api/) and is validated against [`@albusforge/schema`](../../packages/schema/). With `API_MODE=mock` the client answers from [`src/mocks`](src/mocks/); with `live` it calls gateway. Pages that fetch are rendered per request — nothing environment-specific is baked into the image, so the digest promoted from staging to prod is the one that was tested ([ADR 0001](../../docs/adr/0001-shared-ci-project.md)).

## Layout

| Path | What it is |
| --- | --- |
| [`src/app/`](src/app/) | routes |
| [`src/components/`](src/components/) | shell, UI primitives, landing, carousel |
| [`src/lib/`](src/lib/) | API client, formatting, SSE, accents |
| [`src/mocks/`](src/mocks/) | mock API responses (the prototype's data) |
| [`src/styles/`](src/styles/) | design tokens |
| `Dockerfile` | production image; build from the **repo root** (`docker build -f apps/web/Dockerfile .`) |

## Not yet

- Auth: the `(app)` layout has a marked TODO where the session guard goes.
- The landing conversation, sign-up flow, and pixel work on every screen except the landing page's empty state.
- A deploy job — it needs the WIF and Artifact Registry from the infra PR.
