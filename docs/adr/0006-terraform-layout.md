# 0006 — Terraform layout: a bootstrap root and a workspace-per-environment root

**Status:** Accepted, 2026-09-12

## Context

ARCHITECTURE.md §12.2 specifies "Terraform in `infra/`, workspaces `staging` and `prod`". Some resources can't live inside those workspaces: the projects themselves, the bucket that holds workspace state, the shared Artifact Registry and WIF pool, and the DNS delegation between environments. A workspace cannot create its own backend, and neither environment should own shared infrastructure.

## Decision

- **`infra/bootstrap/`** is a single state, applied by a human with billing rights. It holds projects, APIs, the state bucket, Artifact Registry, WIF, the deployer SAs, DNS zones and budgets. Its first apply uses local state, which is then migrated into the bucket it created.
- **`infra/env/`** is one configuration used with workspaces `staging` and `prod`, as §12.2 specifies. It reads bootstrap outputs through `terraform_remote_state`. All per-environment differences live in one `settings` map.
- **`infra/modules/`** holds the pieces `env/` composes.

## Consequences

- Staging and prod cannot drift in *shape*, only in the values set in `settings`.
- Environment roots need no project-creation or billing permissions.
- Workspace selection is the easiest thing to get wrong. The `default` workspace fails at plan by design.
- Changing a bootstrap output that `env/` reads requires re-planning both workspaces.
