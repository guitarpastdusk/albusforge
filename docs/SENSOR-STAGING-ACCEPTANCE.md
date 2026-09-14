# Staging upload acceptance

This harness is prepared for execution after the authorized staging rollout.
It does not deploy resources or enable uploads. Run it only after the private
bucket, migrations and certified Cloudlink release pass their gates, and staging
uploads have been explicitly enabled. Do not use the loopback-only development
provisioner against staging.

Preview the exact target without credentials or network access:

```sh
pnpm --filter cloudlink exec tsx src/staging-acceptance-cli.ts \
  --project albusforge-staging --origin https://staging.albusforge.ai \
  --bucket albusforge-staging-observations
```

Execution additionally requires:

- An absolute path to a Cloud SQL Auth Proxy v2 executable (`--proxy-binary`) and
  its approved-source SHA256 (`--proxy-sha256`). The bytes are checked before
  executing either its version command or listener; obtain the hash through the
  trusted installation/release verification, not by trusting an arbitrary file.
- Existing operator ADC permitted to connect to the staging SQL instance and
  impersonate `observation-maintain-run@albusforge-staging.iam.gserviceaccount.com`.
- `DB_NAME=albusforge`, `DB_USER=albus_app`, the staging application-role
  `DB_PASSWORD`. `DB_HOST=127.0.0.1` satisfies configuration parsing; the harness
  replaces host/port with its own proxy's private listener and uses unencrypted
  loopback PostgreSQL as required by the [Cloud SQL Auth Proxy](https://docs.cloud.google.com/sql/docs/postgres/connect-auth-proxy).
  The proxy authenticates and encrypts the remote connection; normal runtime
  `DB_SSL=require` settings are unaffected.
- `OBSERVATION_STORAGE_WORKER_PATH` pointing to the absolute built
  `packages/storage/dist/storage-worker.cjs` path. Build storage first.

Keep the database password in the existing private environment mechanism; never
paste it into command arguments or commit it. Add `--execute` and the proxy path
and approved hash to the preview command when execution is authorized:

```sh
pnpm --filter @albusforge/storage build
OBSERVATION_STORAGE_WORKER_PATH="$PWD/packages/storage/dist/storage-worker.cjs" \
pnpm --filter cloudlink exec tsx src/staging-acceptance-cli.ts \
  --project albusforge-staging --origin https://staging.albusforge.ai \
  --bucket albusforge-staging-observations \
  --proxy-binary "$APPROVED_PROXY_BINARY" --proxy-sha256 "$APPROVED_PROXY_SHA256" \
  --execute
```

The harness starts its own
proxy pinned to `albusforge-staging:us-central1:albusforge-staging-pg`, on an
allocated loopback port, verifies its startup output, and terminates and awaits
it at completion. An arbitrary existing localhost proxy is not trusted as
evidence of which environment a database belongs to.

The SQL instance has public IPv4 disabled, so the owned proxy explicitly uses
`--private-ip`. The machine running this command still needs an authorized
network route into staging's VPC; the proxy does not create a VPN. Run from an
existing authorized VPC environment if the Mac lacks that route. Do not enable
public SQL connectivity to make this acceptance command work.

The run creates one temporary tenant/device/camera capability using the restricted
application SQL role. A fresh random bearer exists only in memory; no catalogue
drafts or production provisioning profiles are changed. It posts a synthetic
320×240 JPEG and verifies `201`, identical retry `200`, and changed capture-time
`409`. Two numeric v1 posts must both return `202` with only one numeric receipt
and reading. SQL image receipt/usage and GCS generation/bytes must each record
the image once. HTTPS redirects are refused and origin/project/bucket are fixed
to staging.

Cleanup revokes the fixture credential before deleting its tenant. Successful
runs delete the exact object generation and their own cleanup intent. Failed or
ambiguous HTTP runs retain a durable deletion intent for the maintenance worker,
which waits beyond the upload grace period before cleaning late objects. Verify
the subsequent maintenance sweep removes that intent. Soft-deleted fixture bytes
can remain retained for the configured seven days.

This complements `packages/storage/ACCEPTANCE.md`, which separately exercises
all three runtime identities' allowed/denied GCS permissions and unsigned read
denial. No cloud acceptance has been executed merely by adding these harnesses.
