# Sensor Ask integration

The authenticated telemetry monitor (#50, `docs/TELEMETRY-UI.md`) owns fleet selection, latest readings and history charts using the existing `/v1/telemetry` read APIs. This slice adds a sensor-question panel to that device page and a gateway route to the internal Ask service. It introduces no second fleet/dashboard adapter, provisioning metadata model or telemetry stream.

## Routes and identity

`POST /v1/devices/:id/ask` accepts `{text,channel,from,to}` with a positive window of at most 24 hours and a question of at most 2,000 characters. Legacy mock text-only requests continue to work locally; the real route requires an explicit channel/window. The response preserves the existing `{message,queries}` device-chat contract.

The route validates the opaque session, ancestor expiry/revocation and current tenant membership in the existing read-only repeatable-read snapshot. No browser actor or tenant fields are accepted. Ask checks device/channel ownership, obtains actor and tenant from that same snapshot, then releases the database connection before calling the model service. The Ask service independently rechecks membership and device scope. Unknown or another tenant's device/channel returns 404.

## Internal service boundary

`ASK_URL` is the internal Ask origin. `ASK_AUTH=google` (default) obtains a service ID token using that origin as audience; `none` is local-only and startup refuses it on Cloud Run. Production origins require HTTPS and cannot include credentials, paths, queries or fragments. Gateway needs invoker IAM on Ask. An unset URL returns 503; no production fallback selects mocked telemetry or answers.

Gateway sends `POST /v1/ask` using the shared `SensorAskRequest` schema. The client refuses redirects, reads at most 64 KiB, and verifies returned request/device/channel/time-window identity. A 35-second total deadline covers credential acquisition, network and body reading. Upstream errors become fixed user-facing errors; bodies, prompts, credentials and model errors are not logged or relayed. A per-instance 20-question/minute/user limiter bounds ordinary demand; it is not a distributed quota and restarts reset it. Cloud Armor and Ask concurrency/cost limits provide additional independent bounds.

Each reply visibly includes channel, selected start/end (end exclusive), count, units and limitations. “Latest” refers to the selected window. The query audit records the deterministic sensor-window summary input, scoped to the device.

## Interaction and remaining boundaries

The panel uses actual provisioned channel keys and units from the monitor's authenticated device detail. Its channel and last-hour/last-24-hours controls are separate from the history chart controls and make each question explicit. The panel is keyed by tenant and device. Previous messages are shown only in the browser tab and are not sent to the model, as disclosed in the panel. Cross-session transcript persistence and conversational query planning are pending. This slice cannot change thresholds or actuators.

The monitor continues to own paginated fleet/latest/history presentation and explicit rollup/retention error states. Live SSE, provisioning workflows, control actions, model/cloud deployment and physical sensor validation remain separate work. No polling is marketed as SSE.

## Validation

Gateway tests run against PostgreSQL 16 in disposable containers and cover strict Ask fields, session/tenant isolation, trusted actor binding, channel ownership and mapped replies. HTTP-client tests cover scoped payloads, redirects, error redaction, mismatched scope, body limits and cancellation during credential acquisition; a route regression verifies a hung credential lookup cannot exceed its deadline. Mounted panel tests exercise channel/window selection and evidence-bearing answers. Browser checks use live HTTP transport against a contract stub and make no physical telemetry or live model claim.
