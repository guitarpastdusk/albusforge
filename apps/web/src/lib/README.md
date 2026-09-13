# src/lib/

Code with no markup.

| Path | What it is |
| --- | --- |
| [`api/`](api/) | the typed gateway client — server and browser variants, mock mode |
| [`format/`](format/) | relative time, plurals, compact numbers |
| [`sse/`](sse/) | `useEventStream`, the one EventSource hook for builds and telemetry |
| `action-result.ts` | `ActionResult<T>` — what every Server Function in `src/actions` returns |
| `action-errors.ts` | a Server Function failure as a value, logged once with the request's trace |
| `chart.ts` | line-chart geometry: value domain, y mapping, polyline points |
| `accent.ts` | schema `Accent` → pastel Tailwind classes |
| `build-status.ts` | display status → pill label, accent, card action, and where the card links |
| `cx.ts` | class-name joiner |
| `runtime-config.ts` | `API_MODE` (default `live`) and `TRUSTED_PROXY_HOPS` (default 1); mock mode is refused on Cloud Run |
| `log.ts` | structured server logs: one JSON line per call on stdout — `severity`, `message`, a single-string `stack`, and the Cloud Trace fields when `GOOGLE_CLOUD_PROJECT` is set |
| `request-errors.ts` | `onRequestError` reporter and console routing; exactly one ERROR entry per failed request, deduped by digest |
| `startup.ts` | called from `instrumentation.ts`: invalid config logs and exits 1, so a bad Cloud Run revision fails instead of serving 500s |
