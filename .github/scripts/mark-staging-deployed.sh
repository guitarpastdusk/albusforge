#!/usr/bin/env bash
# Record that staging ran DIGEST by tagging it staging-deployed-$GITHUB_SHA.
#
# promote-web requires this tag, so it must never be added to a digest staging
# didn't successfully serve. deploy-web runs this after a successful deploy or a
# skip, and this script checks for itself that the revision serving all of
# staging's traffic runs exactly this digest, rather than trusting the step order.
# Tags are immutable, but adding a new tag to an existing digest is allowed, and
# an existing marker is left alone, so re-runs are safe.
#
# Usage: mark-staging-deployed.sh DIGEST. Env: REPO SERVICE PROJECT REGION GITHUB_SHA.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
: "${PROJECT:?PROJECT is required}" "${REGION:?REGION is required}" "${GITHUB_SHA:?GITHUB_SHA is required}"
digest="${1:-}"
require_digest "$digest"
require_sha "$GITHUB_SHA"
tag="staging-deployed-$GITHUB_SHA"

rc=0
tags="$(image_tags "$digest")" || rc=$?
[ "$rc" = 0 ] || fail "Could not list tags for $digest in $REPO/$SERVICE (status $rc)."

if printf '%s\n' "$tags" | grep -qxF "$tag"; then
  note "$digest is already tagged $tag."
  exit 0
fi

rc=0
serving="$(serving_image "$PROJECT")" || rc=$?
[ "$rc" = 0 ] || fail "Could not confirm which revision serves $SERVICE in $PROJECT (status $rc); not marking $digest."
# Exact match on the full reference, never on the digest alone: a revision
# records its image resolved to a digest, and deploy-web always deploys
# $REPO/$SERVICE@<digest>, so a matching deploy records this exact string.
[ "$serving" = "$REPO/$SERVICE@$digest" ] ||
  fail "$PROJECT serves $serving, not $REPO/$SERVICE@$digest. Not marking a digest staging isn't serving."

gcloud artifacts docker tags add "$REPO/$SERVICE@$digest" "$REPO/$SERVICE:$tag"
note "Tagged $digest as $tag."
