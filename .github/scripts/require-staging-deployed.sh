#!/usr/bin/env bash
# Fail unless DIGEST was successfully deployed to staging.
#
# The deploy workflows push an image before deploying it, so a digest being in
# the registry doesn't prove staging ran it: a failed or cancelled staging deploy
# leaves one behind. They add the tag staging-deployed-<commit> only after a
# successful deploy, and this requires that tag.
#
# Usage: require-staging-deployed.sh DIGEST. Env: REPO, and SERVICE or IMAGE (lib.sh).
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
digest="${1:-}"
require_digest "$digest"

rc=0
tags="$(image_tags "$digest")" || rc=$?
case "$rc" in
  0) ;;
  3) fail "$digest is not in $REPO/$IMAGE." ;;
  *) fail "Could not list tags in $REPO/$IMAGE." ;;
esac

marker="$(printf '%s\n' "$tags" | grep -E '^staging-deployed-[0-9a-f]{40}$' | head -n 1 || true)"
[ -n "$marker" ] || fail "$digest was pushed but never successfully deployed to staging."
note "$digest was deployed to staging ($marker)."
