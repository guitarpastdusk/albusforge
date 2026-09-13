#!/usr/bin/env bash
# Record that staging ran DIGEST by tagging it staging-deployed-$GITHUB_SHA.
#
# The promote workflows require this tag, so it must never be added to a digest
# staging didn't successfully run. The deploy workflows run this after a
# successful deploy or a skip, and this script checks for itself rather than
# trusting the step order:
#   - SERVICE: the revision serving all of staging's traffic runs exactly DIGEST
#   - JOBS: every job's latest successful execution ran exactly DIGEST
# Tags are immutable, but adding a new tag to an existing digest is allowed, and
# an existing marker is left alone, so re-runs are safe.
#
# Usage: mark-staging-deployed.sh DIGEST.
# Env: REPO, SERVICE or JOBS + IMAGE (lib.sh), PROJECT REGION GITHUB_SHA.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
: "${PROJECT:?PROJECT is required}" "${REGION:?REGION is required}" "${GITHUB_SHA:?GITHUB_SHA is required}"
digest="${1:-}"
require_digest "$digest"
require_sha "$GITHUB_SHA"
tag="staging-deployed-$GITHUB_SHA"
# Exact match on the full reference, never on the digest alone: a revision or
# execution records its image as deployed, and the deploy workflows always
# deploy $REPO/$IMAGE@<digest>, so a matching deploy records this exact string.
expected="$REPO/$IMAGE@$digest"

rc=0
tags="$(image_tags "$digest")" || rc=$?
[ "$rc" = 0 ] || fail "Could not list tags for $digest in $REPO/$IMAGE (status $rc)."

if printf '%s\n' "$tags" | grep -qxF "$tag"; then
  note "$digest is already tagged $tag."
  exit 0
fi

if [ -z "$JOBS" ]; then
  rc=0
  serving="$(serving_image "$PROJECT")" || rc=$?
  [ "$rc" = 0 ] || fail "Could not confirm which revision serves $SERVICE in $PROJECT (status $rc); not marking $digest."
  [ "$serving" = "$expected" ] ||
    fail "$PROJECT serves $serving, not $expected. Not marking a digest staging isn't serving."
else
  for job in $JOBS; do
    rc=0
    ran="$(job_image "$PROJECT" "$job")" || rc=$?
    [ "$rc" = 0 ] || fail "Could not confirm the latest successful execution of job $job in $PROJECT (status $rc); not marking $digest."
    [ "$ran" = "$expected" ] ||
      fail "Job $job in $PROJECT last succeeded with $ran, not $expected. Not marking a digest staging didn't run."
  done
fi

gcloud artifacts docker tags add "$expected" "$REPO/$IMAGE:$tag"
note "Tagged $digest as $tag."
