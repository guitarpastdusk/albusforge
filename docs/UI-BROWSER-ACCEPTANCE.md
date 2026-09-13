# Local browser acceptance

A1/Q1 acceptance now has a reproducible Playwright journey against **production-built Next.js, the bundled gateway, and disposable PostgreSQL 16**. It never points at a deployed environment and needs no email or model-provider credentials. This complements the deployed sensor acceptance harness; it does not replace deployment, real email delivery, or hardware acceptance.

## Run

Node/pnpm versions follow `.nvmrc` and `packageManager`. Docker must be running; the test downloads `postgres:16-alpine` if needed. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter web exec playwright install --with-deps chromium
pnpm --filter @albusforge/db build
pnpm --filter gateway build
pnpm --filter web build
pnpm --filter web typecheck:browser
pnpm --filter web test:browser
```

For an existing local Chrome installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable instead of downloading Chromium. On macOS with Colima, also set `DOCKER_HOST=unix://<home>/.colima/default/docker.sock` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` when running the test. The default CI path uses Playwright's installed Chromium and GitHub's local Docker socket. There is no remote base URL override.

The `ui-browser` workflow executes this command for relevant web/gateway/schema/database/config changes and main pushes, with a manual dispatch option. The browser job is separate from component/unit tests. One worker, no automatic retries, a 90-second journey timeout and a 15-minute CI job limit keep failures visible. Typical warmed local execution is about 25 seconds including stack setup/cleanup; image/browser downloads and production builds add time.

## What is real, what is substituted

- The harness creates a fresh PostgreSQL container, a migration owner and `albus_app`, runs normal compiled migrations, and starts the actual compiled gateway process using the restricted app role. No existing database is accepted. Child processes and the container are cleaned up after success or failure.
- The actual email-code routes generate, hash, verify and consume codes, create sessions/tenants, claim anonymous builds/model records and revoke sessions. Gateway's existing local-only `EMAIL_ADAPTER=log` becomes an in-memory email sink; codes are parsed from stdout and are not printed by the harness. This does not test Resend or mailbox deliverability.
- A deterministic **intake HTTP fixture** replaces the external intake/model provider only. It writes an assistant reply and a clearly named fixture model-call record to the disposable database. User messages, intake dispatch, owner checks, SSE delivery, session cookies, anonymous claim and Usage queries use real application code. This does not validate intake extraction, model quality, pricing accuracy, solver plans or generated artifacts.
- Telemetry device/raw/latest rows are explicitly seeded. The browser exercises real gateway session/tenant checks and real history/latest queries against those rows. This is not ingestion, provisioning, retention/rollup-worker, Ask provider, or hardware acceptance.
- Both browser contexts allow network requests only to the ephemeral local web origin. Provider credentials/Cloud Run auth configuration are removed from child environments; web/gateway/intake targets are fixed to the harness's local services. Dependency/browser/container downloads still use their normal registries during setup.
- Chrome treats loopback HTTP as trustworthy for these Secure cookies. The test asserts Secure/HttpOnly/SameSite/path properties but does not validate production TLS, load balancers, Cloud Armor, tenant hostnames, email links or cross-domain handoff.

## Journey and assertions

1. Start an anonymous build in the real landing chat, receive the persisted deterministic reply through real SSE, and verify anonymous ownership in PostgreSQL.
2. Open the protected project, follow the preserved sign-in destination, request a code through the real form, take that code from the local email sink, and verify through the real form.
3. Confirm return to the original project, Secure/HttpOnly session cookie issuance and anonymous-cookie removal. Query PostgreSQL to prove both build and fixture model-call ownership transferred to the new tenant.
4. Reload the project, resume the original transcript, send another message, and check the two recorded model-call estimates through the real Usage page.
5. Seed one channel/sample and inspect its actual latest reading and history table through the telemetry page.
6. Sign in a separate browser context as another tenant. Confirm empty Usage and refusal of the first tenant's project/device, including the gateway's authoritative 404. Next may stream a loading shell with HTTP 200 before rendering a not-found boundary; refusal content and absence of sample data are asserted as well.
7. Sign out, assert cookie removal and database revocation, and verify direct protected project/Usage/device navigation returns to sign-in with its destination preserved.

Screenshots for the claimed project, Usage and telemetry are saved under `apps/web/test-results`. On failure Playwright retains its trace, screenshot and error context; CI uploads reports for seven days. These artifacts contain only synthetic accounts/data but may include disposable codes/session cookies. An attached JSON record identifies the exact Git commit, timestamp, Node/Chrome/PostgreSQL versions and fixture boundary. `playwright-report` and `test-results` are ignored by Git and ESLint.

## Limits and follow-up

This first journey uses a desktop Chromium viewport. Component suites remain responsible for exhaustive failure/rate-limit/partial-data schedules; accessibility and broader mobile/browser acceptance remain separate Q1–Q3 work. Auth recovery's resend/edit-email schedules can be added once their dedicated UI change lands. Real deployment/email/sensor acceptance remains an explicit operational gate, not an inference from this local pass.
