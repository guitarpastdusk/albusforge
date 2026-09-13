# packages/schema/

The API contract as zod schemas, with the TypeScript types inferred from them. Gateway validates with these on the way out; the portal validates with them on the way in. Neither side keeps its own copy of a shape.

Scope today is the **portal-facing surface** — the routes the six portal screens call — plus the **Part Definition**. Spec, BuildPlan, snapshots and events ([`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §3) join as their milestones start.

Consumed as TypeScript source (`exports` points at `src/index.ts`); Next.js compiles it through `transpilePackages`. There is no build step.

| File | What it covers |
| --- | --- |
| `src/common.ts` | ids, timestamps, the error shape, pastel accents |
| `src/cookies.ts` | the session and anonymous-owner cookie names, and the forwarding allowlist |
| `src/auth.ts` | email-code sign-in and the session (`/v1/me`) |
| `src/builds.ts` | build summaries and detail, chat messages, the device-ready card |
| `src/showcase.ts` | the landing carousel feed |
| `src/fleet.ts` | tenant fleet: systems and device tiles |
| `src/device.ts` | the derived device dashboard, series, device chat |
| `src/listings.ts` | marketplace listings and remix |
| `src/usage.ts` | the tenant's usage for the current period, per model tier |
| `src/routes.ts` | every route's method, path pattern and path builder |
| `src/part.ts` | the Part Definition (ARCHITECTURE.md §4) that [`registry/`](../../registry/) validates against |
| `src/parts.ts` | `GET /v1/parts` and `/v1/parts/:id`: the query, and the list and detail responses around the Part Definition |
| `src/connector.ts` | connector standards referenced by `electrical.connector` |
| `src/spec.ts` | the `Spec` intake produces (ARCHITECTURE.md §7.1, plus `capabilities`, `assumptions`, `open_questions`, `settled`), the per-turn `SpecTurn` the model returns, and intake's internal `POST /v1/turns` request and response |
