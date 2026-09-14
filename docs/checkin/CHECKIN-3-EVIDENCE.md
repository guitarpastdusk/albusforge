# Check-in 3 — evidence and statistics

Companion to [CHECKIN-3.md](CHECKIN-3.md). Every number here was measured at a fixed boundary; later changes to `main` do not change this snapshot.

## 1. Fixed comparison boundary

| | Tag object | Commit it points at | Date |
| --- | --- | --- | --- |
| Start | `CHECKIN2` = `28c4ac1` | `9cd94be` | 13 Sep 2026 |
| End | `CHECKIN3` = `f0a4b2e`* | `38c93d0` | 14 Sep 2026, 00:49 EDT |

Both are **annotated tags**, so the tag object's own SHA differs from the commit it points at; `git rev-parse CHECKIN2^{}` yields the commit. Git peels the tag automatically, so `git diff CHECKIN2 CHECKIN3` compares the commits and every statistic below is unaffected. *The end tag object SHA is whatever `git rev-parse CHECKIN3` prints in your clone; the commit is the fixed value shown.

## 2. Repository totals

| Measure | Check-in 2 | Check-in 3 |
| --- | ---: | ---: |
| Merged PRs in the interval | 21 | **37** |
| Files changed in the interval | — | **453** |
| Lines added / removed | — | **+41,155 / −685** |
| Tracked files | 510 | **857** |
| Test source files | 77 | **151** |
| CI jobs | 5 | **8** |
| ADRs | 10 | 10 |

**Honest qualification on the line count.** Of the +41,155 lines, **13,408 are generated Drizzle migration snapshots** under `packages/db/migrations/meta/`. The hand-written SQL across migrations 0003–0007 is roughly 134 lines. Treat the total as a measure of activity, not of product.

### Change by area (top ten, additions)

| Area | + | − |
| --- | ---: | ---: |
| `packages/db` (incl. 13,408 generated) | 14,346 | 9 |
| `apps/gateway` | 6,206 | 109 |
| `apps/web` | 5,819 | 352 |
| `apps/intake` (new) | 3,913 | 0 |
| `.github/workflows` | 1,478 | 3 |
| `packages/llm` (new) | 1,466 | 0 |
| `infra/env` | 1,080 | 29 |
| `apps/codegen` (new) | 928 | 0 |
| `apps/ask` (new) | 684 | 0 |
| `packages/schema` | 666 | 15 |

New workspaces this interval: `apps/intake`, `apps/ask`, `apps/codegen`, `packages/llm`, and the `firmware/` tree (19 files, ~403 lines of source).

## 3. Every merged PR in the interval

PRs #37 through #76, in merge order.

| PR | Title |
| --- | --- |
| #40 | Add partitioned telemetry storage, durable rollups and guarded retention |
| #43 | docs: UI usage analytics scoping and privacy assessment |
| #42 | Live sensor UI: scoped SSE readings, reconnect recovery and mobile layouts |
| #46 | Gateway tests: widen the database timeout budgets for loaded runners |
| #44 | Add authenticated telemetry fleet, latest and history APIs |
| #45 | Gateway: email-code sign-in, sessions and tenant-scoped build routes |
| #37 | M2 intake: packages/llm, the Spec schema, and the intake service |
| #51 | Preserve deployed LLM spend monitoring configuration |
| #54 | Add bounded sensor Ask service with verified evidence and durable budgets |
| #50 | Connect Live systems to stored telemetry and bounded history |
| #52 | Add sensor ingestion, processing and Ask cloud infrastructure |
| #47 | Document sensor cloud rollout and bounded small-model Ask architecture |
| #53 | Add authenticated sensor Ask to the telemetry monitor |
| #57 | Fix build event authorization and message read race |
| #58 | Gate intake deadline tests on actual metering phases |
| #56 | Record complete UI backlog and first-wave delivery status |
| #49 | Add project workspace and preserve build continuation through signup |
| #55 | Add workspace usage dashboard and tenant-scoped consumption API |
| #60 | Bound staging sensor rollout within measured SQL capacity |
| #48 | Add public build and telemetry guides with security status |
| #61 | Monitor sensor backlog, processing heartbeats and pool capacity |
| #59 | Add verified sensor rollout acceptance and quota diagnostics |
| #66 | Keep maintenance log alert within supported 25-hour history |
| #62 | Refresh UI delivery ledger and parallel completion plan |
| #63 | Add accessible page loading and recovery states |
| #64 | Add email code recovery and server-backed retry countdowns |
| #65 | Add reproducible browser acceptance for real auth and project journeys |
| #69 | Add existing-device setup and authenticated reception confirmation |
| #70 | docs: track B3 B6 B8 build-to-device delivery |
| #71 | Add fleet search and protected device display names |
| #68 | Add authorized workspace switching with cross-tab state reset |
| #67 | Record sensor rollout progress and explicit environment inputs |
| #74 | Docs: record who applies infra/env Terraform |
| #72 | Add trusted build-plan persistence and BOM acceptance |
| #76 | Document extensible sensor uploads and preserve Freenove bring-up |
| #73 | Provision self-flash devices with private retry-safe configuration handoff |
| #75 | Add accepted-plan firmware compilation, versioned artifacts and self-flash UI |

## 4. Test and CI evidence

### Captured main: `38c93d0`

Counts are the **runner's own totals** from CI run [34807423132](https://github.com/guitarpastdusk/albusforge/actions/runs/34807423132), not static greps of `it(`.

| Workspace | Passing | Reported total |
| --- | ---: | ---: |
| `apps/web` | 671 | 671 |
| `apps/gateway` | 320 | 321 (1 skipped) |
| `registry` | 125 | 125 |
| `apps/intake` | 108 | 108 |
| `apps/matcher` | 60 | 60 |
| `packages/llm` | 32 | 32 |
| `apps/ask` | 28 | 28 |
| `apps/cloudlink` | 23 | 23 |
| `packages/db` | 22 | 22 |
| `apps/codegen` | 6 | 6 |
| **Total** | **1,395** | |

Check-in 2 reported **871** passing TypeScript tests; this is a **+524** increase. Test source files went from 77 to 151.

### Outside the `check` job

| Suite | Result | Where |
| --- | --- | --- |
| Browser journeys | **9 passed** (1.8 min, 1 worker) | `ui-browser` run [34807423129](https://github.com/guitarpastdusk/albusforge/actions/runs/34807423129) |
| Delivery checks | **92 named checks** | `deploy-scripts` job, stubbed `gcloud`, throwaway git history |
| Firmware encoder | compiled `-Wall -Wextra -Werror` and asserted | `firmware-compile` job |
| CAD spike | 132 tests, **unchanged since Check-in 2** | `spikes/fit`, local, outside CI |

The browser suite is a **real browser/gateway/database integration harness with explicitly substituted authority**. Real: Playwright Chromium against a production `next start` build, the compiled `apps/gateway/dist/server.js` as a child process, and a disposable `postgres:16-alpine` container running the real migrations under the restricted `albus_app` role. Sign-in codes are parsed from a log email sink.

Substituted, and material to how the nine journeys should be read:

| Substitute | Where |
| --- | --- |
| Model provider — deterministic in-process intake fixture, no paid call | all journeys |
| **Synthetic compiler** — `fixtureCompile` returns literal "SYNTHETIC browser artifact" buffers and a synthetic ZIP | `e2e/firmware.spec.ts` |
| **Seeded accepted plans** and approved profile/compiler authority inserted directly | firmware and provisioning journeys |
| Seeded telemetry rows | live, fleet and setup journeys |

So the browser journeys are **not** a compiler-to-installer demonstration over approved parts. The pinned ESP-IDF compiler and the host encoder are exercised separately, in the `firmware-compile` CI job — and neither involves physical flashing.

### CI jobs: 5 → 8

| Job | Verifies |
| --- | --- |
| `check` | typecheck, lint, test, build across the workspace |
| `docker` | web image build |
| `docker-gateway` | gateway + database image smoke against PostgreSQL |
| `docker-intake` | **new** — intake image smoke |
| `docker-ask` | **new** — `/healthz` 200, `/readyz` 503 fail-closed with no DB or model, non-root UID, clean SIGTERM |
| `docker-cloudlink` | ingest image smoke, PostgreSQL-backed |
| `deploy-scripts` | delivery script suite, no cloud access |
| `firmware-compile` | **new** — real pinned ESP-IDF toolchain compiles a synthetic accepted plan; encoder assertions; `fwbuild` worker image |

## 5. Deployment and live evidence

Verified against GCP directly, not inferred from workflow status.

| Service | Production revision | Source |
| --- | --- | --- |
| `gateway` | `gateway-00007-l2s`, 100% traffic | `38c93d0` |
| `intake` | `intake-00003-85r`, 100% traffic | `38c93d0` |
| `web` | `web-00012-j8p`, 100% traffic | `38c93d0` |
| `ask` | `ask-00003-pd2`, 100% traffic | `03f40c1` (unchanged) |
| `cloudlink` | `cloudlink-00002-cxl`, 100% traffic | `03f40c1` (unchanged) |

Staging runs the same source. Every promoted digest is the exact staging-certified image; `db-migrate` and `registry-load` ran against the production database before `gateway` took traffic.

| Live check | Result |
| --- | --- |
| `https://albusforge.ai/` | 200 |
| `https://albusforge.ai/marketplace` | 200 |
| `https://albusforge.ai/v1/parts` | 200, **12 parts** |
| `https://albusforge.ai/v1/me` | **401** (was 501 at Check-in 2) |
| `https://staging.albusforge.ai/` | 200 |

**Model calls actually made and attributed.** One real intake turn on staging: `claude-opus-5`, `cost_usd 0.103305`, correlated in the `llm_calls` table and the `event=llm_call` log line that feeds the spend metric. Two sensor-Ask acceptance calls: `claude-haiku-4-5`, $0.000386 each. Spend alerts fire at $1 per hour and $3 per **22-hour** window on staging, $2 and $5 in production. The longer window is 22 hours, not 24: Monitoring reads at most 24 hours of history and a sliding window needs about an hour of headroom. **These alert; they are not a provider-enforced cap.**

## 6. Physical hardware log

From `hardware/freenove/` (logs are gitignored and live only in the working checkout; the configuration and tooling are committed).

| Step | Measured result |
| --- | --- |
| Chip identification | ESP32-S3 QFN56 rev v0.2, 8 MB PSRAM, 16 MB flash |
| Full flash backup | 16 MB read, MD5 verified, SHA-256 `bf948696…1cd03c5` |
| Compile | ESPHome 2026.8.2 / ESP-IDF 5.5.5, 1,049,223 bytes, RAM 37.7%, flash 12.9% |
| Serial flash | 738,668 compressed bytes in 65.5 s, "Hash of data verified" |
| Network | Joined Wi-Fi, −63 to −69 dBm |
| Camera | GC0308 PID `0x009b`, MJPEG **4.7–4.9 fps** at 320×240 |
| OTA | Upload succeeded in 6.25 s |
| Defect found and fixed | `agc_value: 0` mapped to hardware gain zero → uniformly black frames; `agc_value: 10` verified by a decoded 14,088-byte JPEG |

**This is ESPHome camera firmware, not the Albus firmware in `firmware/`.** It does not reach our cloud. Our own firmware has not been flashed or measured on any board.

## 7. Outstanding work, excluded from merged-main accomplishments

- **`fwbuild` job has no Terraform.** Its contract is specified in `docs/FIRMWARE-PIPELINE.md`; production firmware compilation is not deployable at this tag. Creating the job alone is not enough — the immutable artifact bucket, gateway and worker IAM and environment, and invocation/recovery scheduling are all part of that contract.
- **The gateway has no deployed handoff configuration.** `DEVICE_HANDOFF_KEYS` and `DEVICE_INGEST_URL` are absent from the Terraform configuration and from the production gateway environment, and `device-provisioning-store.ts` refuses issuance without both. Approving profiles and deploying `fwbuild` still would not make the provisioning and flash journey work.
- **Gateway telemetry SSE returns `501`.** The live UI's stream is exercised only against the local browser stack.
- **Registry manifests ship empty by design** — `assembly-profiles.json` and `provisioning-profiles.json` — so build plans and device registration fail closed in production. All 12 parts remain drafts.
- **Daily telemetry maintenance has never been observed firing on schedule**; only manual and seeded runs succeeded.
- **Alert delivery proven on staging only**, via a temporary synthetic policy that was removed afterwards.
- **No sustained-load certification.** The largest check was 30 requests at concurrency 10. SQL connection reservations are planning figures, not enforced caps.
- **No physical device has reached the cloud.** All ingest evidence is encoder- or simulator-driven.
- **No enclosure has been printed.** The CAD spike's fit log contains zero physical measurements.
- **Real sign-in email delivery is untested.** `auth.albusforge.ai` is verified in Resend, but no production code has been sent.
- **`docs/UI-BACKLOG.md` is stale** against this tag: several items it lists as in flight have merged.
- Two orphaned GitHub run records (`34793442644`, `34793442663`) remain queued with zero jobs and refuse cancellation; their replacements succeeded. They are not drained history.

### Device and firmware limitations carried from the design documents

- **No physical qualification of any kind:** no driver, wiring or sensor-accuracy measurement, no reboot or network-recovery testing, no production-profile qualification. A passing host encoder or a synthetic accepted plan establishes none of it.
- **One pending packet, not an offline queue.** The firmware persists a single packet before upload; measurements pause while retries continue. The reporting interval is compiled in, not remotely controlled.
- **No device-side secret protection.** Secure Boot and flash encryption are not implemented, so the cloud's encrypted handoff does not protect credentials once they are in device NVS. There is no credential-downlink rotation.
- **Sensor Ask is a bounded classifier**, not analysis: it selects a channel and window, and every number is computed by SQL. It performs no cross-sensor reasoning, no anomaly detection and no actions. Ledger reconciliation and retention policy remain operational follow-ups.
- **No production intake turn and no production email have been performed.** Both paths are deployed; neither has been exercised with a real request.

## 8. Reproduction

```bash
# Fixed boundary
git diff --shortstat CHECKIN2 CHECKIN3
git log --oneline CHECKIN2..CHECKIN3

# Test totals (requires pnpm install)
pnpm turbo run typecheck lint test

# Delivery checks, no cloud access
bash .github/scripts/test/run.sh

# Browser journeys (requires Docker for the disposable database)
pnpm --filter web test:browser
```
