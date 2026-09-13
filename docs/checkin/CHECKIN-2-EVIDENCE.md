# Check-in 2 — evidence and statistics

Companion to [CHECKIN-2.md](CHECKIN-2.md). This appendix preserves the audit boundary and separates reproducible measurements from previously reported results. The submission's emphasis follows the supplied **Team-Playbook.docx.pdf**, §§4–6: judges score the current build across innovation (30%), technical implementation (25%), business value/impact (25%) and communication (20%). The playbook sets Check-in 2 at hour 24; the hour label is the submission slot, not a claim that the git interval lasted exactly 12 hours.

## 1. Fixed comparison boundary

- **Start:** annotated tag `CHECKIN1`, target `0f7e7c4d7afaa53daf9b21107125391099bfe232` (commit time 2026-09-13 00:44:27 EDT).
- **Tag creation:** 2026-09-13 07:59:45 EDT. Git ranges use the target commit, not the tag object's creation time. All interval merges below also occurred after tag creation.
- **End:** `cbfaa17e9d1b67cda18c2003c83097540f4a1098` (main at 2026-09-13 13:13:07 EDT), PR #34. This is the fixed report snapshot; later merges do not silently change the counts.
- **Compare:** [CHECKIN1…cbfaa17](https://github.com/guitarpastdusk/albusforge/compare/CHECKIN1...cbfaa17e9d1b67cda18c2003c83097540f4a1098).
- **Current status audit:** 13 Sep 2026, approximately 13:13–13:20 EDT. Remote PR states and live responses may change after this audit.

Check-in 1's “14 merged PRs” counted implementation/design PRs #1–14. Its own submission PR #15 is already inside the tag. Therefore the repository ledger has **15 merged PRs at the tag, 21 newly merged PRs, and 36 merged PRs through this snapshot**. The new work count does not include #15 again.

## 2. Repository totals

| Metric | CHECKIN1 | Snapshot | Change |
| --- | ---: | ---: | ---: |
| Tracked files | 189 | 498 | +309 |
| Test source files | 10 | 74 | +64 |
| Workflow files | 3 | 5 | +2 |
| Recorded ADRs (excluding index) | 9 | 10 | +1 |
| CI jobs | 3 | 5 | +2 |
| Merged PRs in repository ledger | 15 | 36 | +21 |

**Interval:** 21 first-parent commits / 21 PR merges; **395 changed file records**, **33,102 text lines added**, **672 deleted**; net +32,430 lines. Three binary file records have no line count. Git status categories: 309 added, 86 modified.

Line counts are engineering activity, **not product impact or original-code counts**. They include generated definitions, migration snapshots, fixtures and locks. Lockfiles alone account for 3,908 additions / 89 deletions; schema/migration directories account for another 4,105 additions. No claim of 33,102 lines of hand-written application logic is made. Test-file counting recognizes `*.test.ts/tsx/js/...` and `test_*.py`; it excludes Bash checks and reviewer-only probes outside the repository.

### Change by area

| Area | Changed records | Added lines | Deleted lines | Binary records |
| --- | ---: | ---: | ---: | ---: |
| `.dockerignore` | 1 | 1 | 0 | 0 |
| `.github` | 11 | 1,207 | 89 | 0 |
| `.gitignore` | 1 | 3 | 0 | 0 |
| `apps/README.md` | 1 | 3 | 0 | 0 |
| `apps/cloudlink` | 21 | 657 | 0 | 0 |
| `apps/gateway` | 35 | 4,042 | 0 | 0 |
| `apps/matcher` | 20 | 1,024 | 0 | 0 |
| `apps/web` | 141 | 9,120 | 454 | 3 |
| `docker` | 2 | 84 | 0 | 0 |
| `docker-compose.yml` | 1 | 23 | 0 | 0 |
| `docs` | 9 | 439 | 29 | 0 |
| `infra` | 22 | 772 | 7 | 0 |
| `packages/README.md` | 1 | 2 | 1 | 0 |
| `packages/db` | 25 | 4,626 | 0 | 0 |
| `packages/schema` | 9 | 702 | 3 | 0 |
| `pnpm-lock.yaml` | 1 | 3,074 | 89 | 0 |
| `pnpm-workspace.yaml` | 1 | 9 | 0 | 0 |
| `registry` | 58 | 4,222 | 0 | 0 |
| `spikes/fit` | 35 | 3,092 | 0 | 0 |

## 3. Every merged PR in the interval

All times below are 13 Sep 2026, Eastern Daylight Time. PR numbers follow creation order, so merge order differs.

| PR | Merge commit time | Commit | What landed |
| --- | --- | --- | --- |
| [#16](https://github.com/guitarpastdusk/albusforge/pull/16) | 08:18:49 EDT | `a7dfc06` | Design: ask to enclosure (Claude intake, matcher, bodygen, 360 viewer) |
| [#17](https://github.com/guitarpastdusk/albusforge/pull/17) | 08:37:59 EDT | `8c0fdab` | M1 infra: Cloud SQL, migration and registry-load jobs, API key secrets |
| [#18](https://github.com/guitarpastdusk/albusforge/pull/18) | 08:58:50 EDT | `29871ae` | M1: packages/db — Drizzle schema, migrations, runner, client |
| [#20](https://github.com/guitarpastdusk/albusforge/pull/20) | 09:09:59 EDT | `9674113` | Portal: v2 website design, sign-in gate, About us |
| [#19](https://github.com/guitarpastdusk/albusforge/pull/19) | 09:36:35 EDT | `3b9c6e5` | Registry: Part Definition schema, twelve MVP parts, validator and catalogue |
| [#21](https://github.com/guitarpastdusk/albusforge/pull/21) | 09:41:53 EDT | `030a93e` | Portal: 360° enclosure viewer (M5.5) |
| [#22](https://github.com/guitarpastdusk/albusforge/pull/22) | 10:07:48 EDT | `db4c82f` | M1: gateway skeleton with /v1/parts, registry loader, deploy workflows |
| [#24](https://github.com/guitarpastdusk/albusforge/pull/24) | 10:27:31 EDT | `87730fd` | Log the landing showcase failure once, traced, at WARNING for a 501 |
| [#23](https://github.com/guitarpastdusk/albusforge/pull/23) | 10:35:04 EDT | `9e2f11f` | Fit spike: parametric enclosures, lint and coupons for five printers |
| [#25](https://github.com/guitarpastdusk/albusforge/pull/25) | 10:40:45 EDT | `97ffe0f` | DNS: Resend sending records for auth.albusforge.ai |
| [#26](https://github.com/guitarpastdusk/albusforge/pull/26) | 10:50:37 EDT | `d9f3bae` | Give the build-action stub test's wall-clock bounds room for a busy CI runner |
| [#27](https://github.com/guitarpastdusk/albusforge/pull/27) | 10:58:35 EDT | `99c8fb1` | Fit spike: export the GLB in the portal viewer's node contract |
| [#28](https://github.com/guitarpastdusk/albusforge/pull/28) | 11:12:13 EDT | `61f236f` | Example builds on the landing carousel and Marketplace while gateway answers 501 |
| [#31](https://github.com/guitarpastdusk/albusforge/pull/31) | 11:30:23 EDT | `aeb652b` | SSE hook: per-event parsers, onOpen for refetch, close while the tab is hidden |
| [#29](https://github.com/guitarpastdusk/albusforge/pull/29) | 11:46:11 EDT | `8b7ed5c` | M2 infra: intake service, gateway to intake wiring, LLM spend alert |
| [#33](https://github.com/guitarpastdusk/albusforge/pull/33) | 12:06:25 EDT | `14265bd` | Closed-loop rules: propose-then-confirm composer, live toggles, ADR 0010 |
| [#30](https://github.com/guitarpastdusk/albusforge/pull/30) | 12:13:19 EDT | `4b66f1a` | M2 gateway: anonymous builds, chat, build events, background intake turns |
| [#32](https://github.com/guitarpastdusk/albusforge/pull/32) | 12:18:23 EDT | `ca786e7` | Add standalone sensor ingestion service with durable storage and bounded concurrency |
| [#38](https://github.com/guitarpastdusk/albusforge/pull/38) | 12:19:54 EDT | `e0d8512` | Infra: lower the LLM spend budgets to fit the key's $10/day limit |
| [#39](https://github.com/guitarpastdusk/albusforge/pull/39) | 12:30:00 EDT | `ddd2d12` | M3 matcher: deterministic parts solver, wiring and power budgets |
| [#34](https://github.com/guitarpastdusk/albusforge/pull/34) | 13:13:07 EDT | `cbfaa17` | proxyGatewayStream: a gateway SSE proxy for local development |

## 4. Test and CI evidence

### Captured main: cbfaa17

[CI run 34770923427](https://github.com/guitarpastdusk/albusforge/actions/runs/34770923427), completed successfully at this exact revision:

| Package/suite | Test files | Passing tests |
| --- | ---: | ---: |
| Web | 43 | 523 |
| Gateway | 13 | 137 |
| Registry | 6 | 125 |
| Matcher | 5 | 59 |
| Database | 1 | 11 |
| Cloudlink ingestion | 5 | 16 |
| **TypeScript total** | **73** | **871** |
| Deploy scripts (Bash) | — | 53 |

All five jobs succeeded: `check`, `docker`, `docker-gateway`, `docker-cloudlink`, `deploy-scripts`. The check job runs workspace typecheck/lint/tests and builds. Docker jobs verify runnable images; gateway/cloudlink exercise PostgreSQL-backed paths. Tests passing does not establish production throughput.

### CAD spike: outside CI

The Python/CadQuery spike is not part of the pnpm workspace or the five CI jobs. At the snapshot's source, `python -m pytest -q` was rerun locally for this check-in: **132 passed**. It used the existing fit-spike Python 3.12 environment without installing/changing that environment. These 132 are separate from the 871 TypeScript tests and 53 shell checks: **1,056 total passing automated tests across the two execution environments**.

[PR #23](https://github.com/guitarpastdusk/albusforge/pull/23) reports **45/45** printer/layout generation runs passing lint; [PR #27](https://github.com/guitarpastdusk/albusforge/pull/27) reports 132 tests after adding the GLB contract. The 45 build commands were not rerun separately in this audit; the current geometry suite was. Five printer profile JSON files and nine layout JSON files are checked in. All profiles are uncalibrated. `fit-results.csv` contains only its header: **0 physical result rows**.

### Baseline comparisons and review probes

Check-in 1 reported 152 web tests and 25 deploy-script checks. The current corresponding counts are 523 (**+371**) and 53 (**+28**). The baseline was not re-executed during this audit. New suites are reported separately, rather than pretending they were part of the old web count.

The matcher suite includes one test sweeping 120 generated catalogues; those 120 cases are not added again to the 59-test total. The [final independent review](https://github.com/guitarpastdusk/albusforge/pull/39#issuecomment-5654513818) also reports a separate 160-catalogue oracle and activity-order regression. Those reviewer-only probes are not included in the 1,056 total. Initial oracle timing and solver-log ordering findings were fixed and the final head reviewed before merge.

## 5. Deployment and live evidence

| Observation | Evidence/result | What it does not establish |
| --- | --- | --- |
| Staging web delivery | [Run 34770923386](https://github.com/guitarpastdusk/albusforge/actions/runs/34770923386) succeeded at cbfaa17 | Not proof of production promotion |
| Staging gateway/database delivery | [Run 34768759279](https://github.com/guitarpastdusk/albusforge/actions/runs/34768759279) succeeded at ddd2d12 | Not proof of a completed AI conversation |
| Production `/` and `/marketplace` | HTTP 200; example-build label present | Sample readings are not physical telemetry |
| Staging `/` | HTTP 200; example-build label present | No signed-in/device interaction was exercised |
| Production and staging `/v1/parts` | HTTP 200; 12 entries, all draft | No verified production-ready assemblies |
| Physical fit log | Header only, no measurements | ≥90% first-print fit remains a target |

HTTP checks used normal TLS verification with system `curl`. Python's independent certificate bundle initially lacked a trusted issuer; no verification bypass was used. No build-creation/LLM requests were sent and no customer messages or credentials were accessed. Terraform resource counts and live drift were **not** rerun; the Check-in 1 resource totals are not recycled as current measurements. LLM budget alerts are configured in the merged infrastructure but do not prove that an API-account hard cap has been set.

## 6. Outstanding work, excluded from merged-main accomplishments

| Work | State at snapshot audit | Relevance |
| --- | --- | --- |
| PR #36: streaming portal chat | Open; clean reviewed head and green CI before the new helper merge; integration must be rechecked against current main | Completes the client half of real conversation |
| PR #37: intake, LLM wrapper, Spec schema | Open; review-fix iteration, green CI on its newer head | Completes ask-to-spec and usage metering; not live/main evidence yet |
| PR #40: partitioned storage and rollups | Open; CI green, independent review in progress | Operational telemetry storage, not included in merged ingestion claims |
| PR #35: firmware target ADR | Open; changes requested | Target contracts remain unsettled |
| Live sensor UI branch | Local paused WIP, no PR at audit | Two test failures previously recorded; not counted as delivered |
| Firmware/hardware trials | Local spike/coordination; no physical trial evidence in this main snapshot | No completed flash/OTA/device-to-cloud claim |

PR #34 merged while the audit was running and **is included** in cbfaa17. It was not closed as redundant; this report uses the actual GitHub merge state. PR #39 (matcher), #32 (ingestion), #33 (rules) and #38 (spend budgets) are merged and included.

## 7. Reproduction

```sh
git rev-parse CHECKIN1^{}
git show --no-patch --format=fuller CHECKIN1
git log --first-parent --reverse --format='%h %cI %s' CHECKIN1..cbfaa17
git diff --shortstat CHECKIN1 cbfaa17
git diff --numstat CHECKIN1 cbfaa17
git ls-tree -r --name-only cbfaa17
gh run view 34770923427 --repo guitarpastdusk/albusforge --log
# In a checkout of cbfaa17, with the fit dependencies installed:
cd spikes/fit
python -m pytest -q
```

Source-of-truth links are the fixed git comparison, per-PR links, exact CI/deployment runs and the checked-in source. The Team Playbook is the user-supplied three-page local PDF; §§4–6 define cadence, rubric and scoring. No external market-size, traction or revenue evidence was supplied or inferred.
