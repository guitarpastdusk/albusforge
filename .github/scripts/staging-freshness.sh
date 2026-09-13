#!/usr/bin/env bash
# Decide whether this deploy-web run may deploy GITHUB_SHA to staging.
#
# Staging deploys share a concurrency group, which stops them overlapping but not
# an older run (delayed, or re-run by hand) deploying after a newer one. This
# compares GITHUB_SHA with the commit staging actually runs:
#   not a deploy-web image (Terraform's placeholder)  -> deploy
#   the same commit                                    -> skip
#   an ancestor of GITHUB_SHA                          -> deploy
#   newer, diverged, untagged or unknown               -> refuse (exit 1)
# Rolling staging back is deliberately not possible from deploy-web.
#
# Prints action=deploy or action=skip on stdout, for $GITHUB_OUTPUT; messages go
# to stderr. Env: REPO SERVICE PROJECT REGION GITHUB_SHA. Needs the full git
# history (actions/checkout with fetch-depth: 0).
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
: "${PROJECT:?PROJECT is required}" "${REGION:?REGION is required}" "${GITHUB_SHA:?GITHUB_SHA is required}"
require_sha "$GITHUB_SHA"

current="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].image)')"

case "$current" in
  "$REPO/$SERVICE@sha256:"*) ;;
  *)
    note "$PROJECT runs ${current:-no image}, which is not a deploy-web image; deploying $GITHUB_SHA."
    echo "action=deploy"
    exit 0
    ;;
esac

digest="${current#"$REPO/$SERVICE@"}"
rc=0
tags="$(image_tags "$digest")" || rc=$?
case "$rc" in
  0) ;;
  3) fail "$PROJECT runs $current, which is not in $REPO/$SERVICE. Refusing to deploy over an image with no known commit." ;;
  *) fail "Could not list tags in $REPO/$SERVICE; not deploying." ;;
esac

commits="$(printf '%s\n' "$tags" | grep -E '^[0-9a-f]{40}$' || true)"
[ -n "$commits" ] || fail "$PROJECT runs $digest, which has no commit tag. Refusing to deploy over it."

if printf '%s\n' "$commits" | grep -qxF "$GITHUB_SHA"; then
  note "$PROJECT already runs $GITHUB_SHA."
  echo "action=skip"
  exit 0
fi

for deployed in $commits; do
  if ! git merge-base --is-ancestor "$deployed" "$GITHUB_SHA" 2>/dev/null; then
    fail "$PROJECT runs $deployed, which is newer than or diverged from $GITHUB_SHA. Refusing to roll back."
  fi
done

note "$PROJECT runs $(printf '%s' "$commits" | tr '\n' ' '), an ancestor of $GITHUB_SHA; deploying."
echo "action=deploy"
