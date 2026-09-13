# Sensor operational evidence

This implements metrics and policies; it is not evidence of applied resources or delivered notifications. The rollout owner records actual acceptance in [SENSOR-CLOUD-ROLLOUT.md](SENSOR-CLOUD-ROLLOUT.md). Deployment/exclusion sequencing remains [ADR 0005](adr/0005-ci-owns-images-terraform-owns-shape.md).

## Signals and policies

| Signal | Producer and meaning | Initial policy |
| --- | --- | --- |
| `telemetry_dirty_hours` | Exact number of dirty hour markers in a post-rollup database snapshot | Exact above-10,000 breach count for 10m |
| `telemetry_oldest_dirty_seconds` | Age of earliest marker creation; zero for an empty queue, clamped at zero for future clock values | Exact above-900s breach count for 10m |
| `telemetry_default_rows` / `telemetry_default_present` | Exact rows in the raw default partition; separate counter accepts only snapshots with `default_rows>0` | Positive-snapshot count above zero for 10m |
| `telemetry_health_heartbeat` | Rollup succeeded **and** its health query completed; no event on either failure | Missing 15m |
| `telemetry_maintenance_heartbeat` | Maintenance succeeded **and** its health query completed | No success in 26h, evaluated every 5m |
| `ingest_pool_wait_ms` | Measured `pool.connect()` elapsed time, including queue and connection setup; acquired/failed outcome | Recurring exact above-500ms acquisitions for 5m |
| Cloud SQL CPU/disk utilization | Native instance utilization, shared by all applications | Above 80% for 10m |
| Cloud SQL PostgreSQL backends | Native connections, summed across databases on the one instance | Above operator-reviewed ceiling for 5m; disabled while ceiling is zero |

Telemetry snapshots are emitted once after each successful job as structured `event=telemetry_health`. They have no tenant/device/channel/token/readings identifiers. The three health distributions consume rollup snapshots only, avoiding maintenance's daily sample cadence in backlog alerts. Log-based histogram percentiles are bucket estimates, not exact count/age gauges; the source log remains exact. All decisions on these application distributions use separate integer breach counters: `dirty_hours>10000`, `oldest_dirty_seconds>900`, `default_rows>0` and `pool_wait_ms>500`. Histograms are dashboard-only; their interpolation cannot move an alert cutoff. Equality is healthy. Zero and missing row counts are excluded by the [numeric comparison filter](https://docs.cloud.google.com/logging/docs/view/logging-query-language); only exactly above-threshold observations increment their counter. Backlog policies require a positive breach count in each five-minute alignment window for ten minutes. Pool wait requires a positive count in each one-minute alignment window for five minutes: this deliberately changes the decision from p95 latency to recurring slow acquisitions. Even a minority of recurring above-500ms requests can alert; a steady stream of 450ms requests cannot. Missing data is explicitly inactive for these breach policies; heartbeat policies independently detect stalled processing. These are operational starting thresholds, to tune from budgeted load measurements.

A fresh health pool uses max one connection, five-second server statement/connection timeouts and a six-second driver query timeout. It opens **after** the worker pool has closed, so it adds no simultaneous connection to the existing per-job budget. It reads queue count, minimum creation timestamp and default count in one MVCC statement snapshot. Exact counts may scan large tables; if the health scan exceeds its timeout, the job fails after its already-committed work and emits no healthy heartbeat. Retry-safe workers and the existing job-failure policy cover this case; investigate query cost rather than enlarging limits blindly. No schema or grants change.

Cloudlink emits one bounded-cardinality event for every attempted ingestion pool acquisition, both success and failure. It excludes requests rejected before acquisition (bad envelope/token shape or admission saturation). It logs no credentials, device identifiers or SQL errors. This measures acquisition, not SQL execution or device-to-cloud latency.

The dashboard contains ingestion platform p95 and 503 counts, queue/default/age, pool-acquisition p95, completed job executions by result, and shared SQL connections/CPU/disk/read/write operations. Latency charts retain per-revision series rather than incorrectly averaging percentiles. SQL I/O is workload throughput, not an inferred universal saturation limit. Platform metric definitions: [Cloud SQL](https://docs.cloud.google.com/sql/docs/postgres/admin-api/metrics), [Cloud Run](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z).

## Missing execution semantics

All backlog and heartbeat policies follow `telemetry_schedules_enabled`; leave disabled until successful deployed jobs emit visible metrics. The native rollup absence condition needs an initial point after enabling and cannot detect a stream that has never existed. Acceptance must explicitly seed/verify it.

Daily maintenance uses PromQL's 26-hour lookback with five-minute evaluation, supported by [Cloud Monitoring PromQL alerting](https://docs.cloud.google.com/monitoring/alerts/using-promql). Native [metric absence](https://docs.cloud.google.com/monitoring/alerts/metric-absence) has a 23.5-hour maximum and would false-alarm on a daily schedule. The expression combines a zero-total check with `absent_over_time`: a log counter can emit zero values, and those must not count as successful maintenance. No prior series is unhealthy immediately when the policy is enabled; run a successful maintenance job and verify its point first. The two-hour grace covers daily startup/runtime/ingestion delay, not a guarantee of retention health. A completed job with backlog can still be unhealthy, hence separate queue/default policies.

The new log metric can have no descriptor data at initial plan/apply, so the PromQL policy disables metric-data validation. Unit tests run the exact Terraform expression through pinned Prometheus 3.5.0 with recent success, overdue success, zero-only, never-seen and fresh-recovery histories. Actual Cloud Monitoring evaluation and notification delivery must still be exercised after application.

## Activation and acceptance

1. Review `SHOW max_connections` plus service/revision/job budgets and set `sensor_sql_connection_alert_threshold` to a measured ceiling **below** the usable connection budget. Zero intentionally disables this alert. Do not infer a ceiling from vCPU count or hard-code staging's value into production.
2. Apply a fresh reviewed Terraform plan inside the existing exclusion window. Metrics, policies and dashboard do not write service templates, but any combined plan touching service/job templates still requires the full ADR procedure.
3. Build/deploy the new db-jobs and cloudlink images from the reviewed source. Database package source changes also change the conservative migration-release fingerprint: rerun the owner migration/grants job at an equivalent source before sensor release, even though no SQL migration changed.
4. Execute maintenance and rollup; inspect one redacted health event each and resulting counter/distribution points. Ingest a fixture packet and verify acquired pool-wait points, native latency/503 charts and SQL series. Rejected fixture SQL acquisition should produce failed pool-wait points without secrets. The heartbeat is processing evidence, not physical-sensor evidence.
5. Verify the selected email notification channel and deliver a controlled test incident/recovery in staging. A successful API resource creation or visible chart does not establish notification delivery.
6. Enable the schedules and their heartbeat/backlog policies together; confirm a new rollup point after enabling. Verify daily maintenance after its next cadence, and inspect zero/default/backlog health. If schedules are intentionally paused, disable their policies through reviewed Terraform too.

Local validation: `DOCKER_HOST=... TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm turbo run typecheck lint test build --filter=@albusforge/db --filter=cloudlink --env-mode=loose`; mocked Terraform tests in both workspaces; `python3 infra/tests/test-maintenance-heartbeat.py` (Docker). These use local fixtures, no provider calls or cloud mutations.
