# Ask

Internal sensor-scoped chat service. See [service contract, runtime configuration and limitations](../../docs/SENSOR-ASK.md).

```sh
pnpm --filter ask test
pnpm --filter ask typecheck
pnpm --filter ask lint
pnpm --filter ask build
```

Tests use a disposable PostgreSQL 16 container and injected model fixtures. No live model calls are permitted.
