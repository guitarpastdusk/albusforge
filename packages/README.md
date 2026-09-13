# packages/

Shared libraries. No app defines a type that another app needs; it goes here.

| Package | What it is |
| --- | --- |
| [schema](schema/) | zod schemas and route constants for the API contract. Today: the portal-facing surface only. |
| [db](db/) | Drizzle schema, generated migrations, the migration runner, and `createDb`. |
| [llm](llm/) | `callStructured`: one structured Claude call with every failure path handled, prompt caching, metering to `llm_calls` and the spend log, and the per-build token ceiling. |

`queue`, `storage`, `events` and `config` ([`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §3) arrive with later milestones.
