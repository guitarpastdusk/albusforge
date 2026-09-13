#!/usr/bin/env bash
# Record that staging ran DIGEST by tagging it staging-deployed-$GITHUB_SHA.
#
# deploy-web runs this only after gcloud run deploy succeeded, or when staging
# already runs this commit. promote-web requires the tag. Tags are immutable, but
# adding a new tag to an existing digest is allowed, and an existing marker is
# left alone, so re-runs are safe.
#
# Usage: mark-staging-deployed.sh DIGEST. Env: REPO SERVICE GITHUB_SHA.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
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

gcloud artifacts docker tags add "$REPO/$SERVICE@$digest" "$REPO/$SERVICE:$tag"
note "Tagged $digest as $tag."
