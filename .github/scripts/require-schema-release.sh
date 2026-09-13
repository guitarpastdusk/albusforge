#!/usr/bin/env bash
# Prove the latest owner migration completed with matching migration/grant code
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
# Migration failures can commit DDL before failing role provisioning. Generic
# last-success job_image semantics are correct for retries, but unsafe here.
executions="$(gcloud run jobs executions list --job db-migrate --project "$PROJECT" --region "$REGION" --format=json)"
ran="$(printf '%s' "$executions" | jq -er '
  def completion: [.status.conditions[]? | select(.type == "Completed") | .status];
  if type != "array" or length == 0 then error("No migration executions") else . end
  | if any(.[]; (.metadata.creationTimestamp | type) != "string" or
      ((.metadata.creationTimestamp // "") | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$") | not))
    then error("Unknown migration order") else . end
  | if any(.[]; completion != ["True"] and completion != ["False"])
    then error("A migration is running or has unknown completion") else . end
  # Require complete terminal intervals. Completion order does not establish
  # SQL/grant ordering inside overlapping executions. A fresh matching success
  # must start strictly after every other observed execution has completed.
  | map(. + {
      created: (.metadata.creationTimestamp[0:19] + "Z" | fromdateiso8601),
      finished: (if (.status.completionTime | type) == "string" and
        (.status.completionTime | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$"))
        then (.status.completionTime[0:19] + "Z" | fromdateiso8601)
        else error("Missing or invalid migration completion time") end)
    })
  | if any(.[]; .finished < .created) then error("Invalid migration interval") else . end
  | sort_by(.created)
  | . as $all | last as $latest
  | if any($all[0:-1][]; .finished >= $latest.created)
    then error("Overlapping or ambiguous migration history; require fresh non-overlapping recovery")
    else $latest end
  | if completion != ["True"] then error("Latest migration did not succeed") else . end
  | .spec.template.spec.containers[0].image
  | select(type == "string" and length > 0)
')" || fail "Latest migration is not a known completed success; resolve migration state before releasing"
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
      git diff --quiet "$migration" "$source" -- \
        packages/db docker/db-jobs.Dockerfile docker/db-jobs-entrypoint.sh \
        package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .dockerignore \
        .pnpmfile.cjs pnpmfile.cjs patches turbo.json \
        ':(glob)tsconfig*.json' ':(glob)**/package.json' ; then
      matched=true
      break
    fi
  done
  [ "$matched" = true ] || fail "Deploy gateway-owned migrations for this schema before releasing sensor runtimes"
done
