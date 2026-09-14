# Observation object storage

`GcsObservationStorage` stores private JPEG payloads independently of SQL
receipts. `MemoryObservationStorage` from `@albusforge/storage/testing` implements
the same create-only and immutable-generation semantics for local tests.

```ts
const store = new GcsObservationStorage({ bucket: configuredBucket });
const object = await store.create(key, jpeg, { sha256, fingerprint }, signal);
const bytes = await store.read(key, object.generation, signal);
await store.delete(key, object.generation, signal);
```

Keys come from server-side receipt identity, never an arbitrary URL. SHA256 and
fingerprint are lowercase 64-character hex digests. The adapter verifies the
content digest before writing. The default object byte limit is 1 MiB.

Creation uses the [GCS generation-match zero precondition](https://docs.cloud.google.com/storage/docs/request-preconditions).
An existing object raises `StoragePreconditionError`; the caller must `head`
and compare all immutable identity fields to reconcile duplicate or ambiguous
writes. The adapter does not silently treat conflicting content as success.
Generations remain strings, including values above JavaScript's safe integer
range. Reads and deletes identify and condition on the exact generation, so
stale cleanup cannot remove a replacement. Missing generation deletes succeed
idempotently; missing reads raise `StorageNotFoundError`. Authorization and
other service errors propagate.

Authentication uses the pinned Google Cloud Storage SDK's public ADC auth
client and authenticated JSON API requests. No credentials, signed URLs,
bucket creation, or public access configuration live here. Object HTTP calls
carry a default 10-second timeout, caller cancellation, bounded response size,
and disabled automatic retries. Aborted operations are awaited to settlement;
there is no detached `Promise.race` work. An ambiguous create must still be
reconciled by the receipt owner.

**Production readiness limitation:** the SDK performs ADC discovery and token
refresh before dispatching the object HTTP request. Those internal credential
operations do not consistently inherit its abort signal. The object HTTP
deadline therefore does not yet provide a hard bound on credential refresh.
Resolve that isolation/deadline requirement before production activation;
local mock tests do not certify IAM, credentials, or live GCS behavior.

Run `pnpm --filter @albusforge/storage test` for deterministic storage races,
generation safety, digest/size validation, HTTP request contracts, permission
errors, and cancellation tests without cloud access.
