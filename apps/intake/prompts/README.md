# apps/intake/prompts/

Prompts are versioned files, never string literals in code (ARCHITECTURE.md §3). A behaviour change is a new file (`extract.v2.md`) and a route name change in `src/prompts.ts`, so recorded fixtures and logs can say which prompt produced them.

| File | Sent as | Cached |
| --- | --- | --- |
| `extract.v2.md` | the system prompt, followed by the part catalogue | yes: system prompt and catalogue sit before the cache breakpoint |
| `turn.v1.md` | a `role: "system"` message after the latest user message: rounds used and the current spec | no: it changes every turn, so it goes after the breakpoint |

The person's text is never interpolated into either file. It reaches the model only as user turns.

`{{placeholders}}` in `turn.v1.md` are filled by `renderTurnContext` in `src/prompts.ts`; a placeholder left unfilled is an error.
