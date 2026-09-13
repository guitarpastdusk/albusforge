# src/lib/

Code with no markup.

| Path | What it is |
| --- | --- |
| [`api/`](api/) | the typed gateway client — server and browser variants, mock mode |
| [`format/`](format/) | relative time, plurals, compact numbers |
| [`sse/`](sse/) | `useEventStream`, the one EventSource hook for builds and telemetry |
| `accent.ts` | schema `Accent` → pastel Tailwind classes |
| `build-status.ts` | display status → pill label, accent, card action |
| `cx.ts` | class-name joiner |
| `runtime-config.ts` | `API_MODE` (default `live`) and `TRUSTED_PROXY_HOPS` (default 1); mock mode is refused on Cloud Run |
| `startup.ts` | called from `instrumentation.ts`: invalid config logs and exits 1, so a bad Cloud Run revision fails instead of serving 500s |
