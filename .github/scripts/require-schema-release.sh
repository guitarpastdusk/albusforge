#!/usr/bin/env bash
# Prove the last successful owner migration used the same migration/grant code
# as the requested release. Never update or execute the shared migration job.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
: "${PROJECT:?}" "${REGION:?}"
if [ -n "${DIGEST:-}" ]; then
  require_digest "$DIGEST"
  tags="$(image_tags "$DIGEST")"
  sources="$(printf '%s\n' "$tags" | sed -nE 's/^staging-deployed-([0-9a-f]{40})$/\1/p')"
else
  sources="${GITHUB_SHA:?}"
fi
[ -n "$sources" ] || fail "No source commit for requested image"
ran="$(job_image "$PROJECT" db-migrate)"
case "$ran" in "$REPO/db-jobs@sha256:"*) ;; *) fail "Migration job has no certified repository image" ;; esac
migration_digest="${ran#"$REPO/db-jobs@"}"
require_digest "$migration_digest"
tags="$(IMAGE=db-jobs image_tags "$migration_digest")"
migrations="$(printf '%s\n' "$tags" | grep -E '^[0-9a-f]{40}$' || true)"
for source in $sources; do
  require_sha "$source"
  matched=false
  for migration in $migrations; do
    # A same-tree source is enough even when unrelated applications moved on.
    if git merge-base --is-ancestor "$migration" origin/main &&
      git diff --quiet "$migration" "$source" -- packages/db/migrations packages/db/src/migrate.ts; then
      matched=true
      break
    fi
  done
  [ "$matched" = true ] || fail "Deploy gateway-owned migrations for this schema before releasing sensor runtimes"
done
