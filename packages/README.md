# packages/

Shared libraries. No app defines a type that another app needs; it goes here.

| Package | What it is |
| --- | --- |
| [schema](schema/) | zod schemas and route constants for the API contract. Today: the portal-facing surface only. |
| [db](db/) | Drizzle schema, generated migrations, the migration runner, and `createDb`. |

`llm`, `queue`, `storage`, `events` and `config` ([`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §3) arrive with M1 and later.
