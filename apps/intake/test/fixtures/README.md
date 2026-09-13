# apps/intake/test/fixtures/

Model responses replayed by the tests, in the exact `BetaMessage` JSON shape the API returns. Tests never call the API.

| Path | What it is |
| --- | --- |
| `golden/<build>/turn-1.json`, `turn-2.json` | The three golden builds (fridge monitor, presence alert, plant waterer): the model's first turn, which asks about power, and its second, after the person answers. The asks and answers are `GOLDEN_ASKS` in `../fixtures.ts` |
| `recorded/` | Responses captured from the real API by `scripts/live-smoke.ts --record`, when present |

The golden turns are written by hand in the recorded shape, so each test is deterministic and covers a specific path: the plant waterer's first turn includes an off-menu capability (`act.pump_ml`) and an irrelevant question, which intake must drop. Re-record against the real model with the live smoke script when the prompt changes, and review the diff before committing.
