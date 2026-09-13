#!/usr/bin/env bash
# Decide whether this deploy run may deploy GITHUB_SHA to staging.
#
# Staging deploys share a concurrency group, which stops them overlapping but not
# an older run (delayed, or re-run by hand) deploying after a newer one. This
# compares GITHUB_SHA with the commit of what staging actually runs:
#   - for SERVICE, the revision serving all traffic. That is not the service's
#     desired image: a failed deploy updates the desired image while traffic
#     stays on the old revision, and a retry must not mistake it for a
#     successful one.
#   - for each job in JOBS, the image of its latest successful execution.
#
#   running an image not from $REPO/$IMAGE (Terraform's placeholder),
#     or a job that has never succeeded                        -> deploy
#   running the same commit (every job, in JOBS mode)          -> skip
#   running an ancestor of GITHUB_SHA                          -> deploy
#   newer, diverged, untagged, unknown or split traffic        -> refuse (exit 1)
# Rolling staging back is deliberately not possible from the deploy workflows.
#
# Prints action=deploy or action=skip on stdout, for $GITHUB_OUTPUT; messages go
# to stderr. Env: REPO, SERVICE or JOBS + IMAGE (lib.sh), PROJECT REGION
# GITHUB_SHA. Needs the full git history (actions/checkout with fetch-depth: 0).
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
: "${PROJECT:?PROJECT is required}" "${REGION:?REGION is required}" "${GITHUB_SHA:?GITHUB_SHA is required}"
require_sha "$GITHUB_SHA"

# decide WHERE IMAGE: prints deploy or skip for one thing that runs IMAGE, or fails.
# WHERE reads as a subject: "albusforge-staging" or "job db-migrate in albusforge-staging".
decide() {
  local where="$1" current="$2" digest tags commits deployed rc
  case "$current" in
    "$REPO/$IMAGE@sha256:"*) ;;
    *)
      note "$where runs $current, which is not an image from $REPO/$IMAGE; deploying $GITHUB_SHA."
      echo deploy
      return 0
      ;;
  esac

  digest="${current#"$REPO/$IMAGE@"}"
  rc=0
  tags="$(image_tags "$digest")" || rc=$?
  case "$rc" in
    0) ;;
    3) fail "$where serves $current, which is not in $REPO/$IMAGE. Refusing to deploy over an image with no known commit." ;;
    *) fail "Could not list tags in $REPO/$IMAGE; not deploying." ;;
  esac

  commits="$(printf '%s\n' "$tags" | grep -E '^[0-9a-f]{40}$' || true)"
  [ -n "$commits" ] || fail "$where serves $digest, which has no commit tag. Refusing to deploy over it."

  if printf '%s\n' "$commits" | grep -qxF "$GITHUB_SHA"; then
    note "$where already serves $GITHUB_SHA."
    echo skip
    return 0
  fi

  for deployed in $commits; do
    if ! git merge-base --is-ancestor "$deployed" "$GITHUB_SHA" 2>/dev/null; then
      fail "$where serves $deployed, which is newer than or diverged from $GITHUB_SHA. Refusing to roll back."
    fi
  done

  note "$where serves $(printf '%s' "$commits" | tr '\n' ' '), an ancestor of $GITHUB_SHA; deploying."
  echo deploy
}

action=skip
if [ -z "$JOBS" ]; then
  rc=0
  current="$(serving_image "$PROJECT")" || rc=$?
  case "$rc" in
    0) ;;
    4) fail "No single ready revision serves all of $SERVICE's traffic in $PROJECT. Refusing to deploy over an unknown state." ;;
    *) fail "Could not read the revision serving $SERVICE in $PROJECT; not deploying." ;;
  esac
  action="$(decide "$PROJECT" "$current")" || exit 1
else
  for job in $JOBS; do
    rc=0
    current="$(job_image "$PROJECT" "$job")" || rc=$?
    case "$rc" in
      0) verdict="$(decide "job $job in $PROJECT" "$current")" || exit 1 ;;
      4)
        note "job $job in $PROJECT has never succeeded; deploying $GITHUB_SHA."
        verdict=deploy
        ;;
      *) fail "Could not read the executions of job $job in $PROJECT; not deploying." ;;
    esac
    # Skip only if every job already ran this commit; keep checking the rest either way.
    [ "$verdict" = skip ] || action=deploy
  done
fi

echo "action=$action"
