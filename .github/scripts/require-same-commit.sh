#!/usr/bin/env bash
# Fail unless every IMAGE@DIGEST was deployed to staging by the same commit.
#
# promote-gateway ships two images, gateway and db-jobs. Each must carry a
# staging-deployed-<commit> tag (require-staging-deployed.sh), and they must
# share one: a gateway from one commit with migrations from another is a
# combination staging never ran.
#
# Usage: require-same-commit.sh IMAGE@DIGEST IMAGE@DIGEST...
# Prints the shared commit(s) on stdout, one per line. Env: REPO.
set -euo pipefail
# lib.sh wants an image; each argument sets its own below.
IMAGE="${IMAGE:-unset}"
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
[ "$#" -ge 2 ] || fail "usage: require-same-commit.sh IMAGE@DIGEST IMAGE@DIGEST..."

# Validate every argument before calling gcloud.
for ref in "$@"; do
  [[ "${ref%%@*}" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "not an image@digest: '$ref'"
  require_digest "${ref#*@}"
done

shared=""
first=1
for ref in "$@"; do
  IMAGE="${ref%%@*}"
  digest="${ref#*@}"
  rc=0
  tags="$(image_tags "$digest")" || rc=$?
  case "$rc" in
    0) ;;
    3) fail "$digest is not in $REPO/$IMAGE." ;;
    *) fail "Could not list tags in $REPO/$IMAGE." ;;
  esac
  commits="$(printf '%s\n' "$tags" | sed -n 's/^staging-deployed-\([0-9a-f]\{40\}\)$/\1/p' | sort -u)"
  [ -n "$commits" ] || fail "$REPO/$IMAGE@$digest was never successfully deployed to staging."
  if [ "$first" = 1 ]; then
    shared="$commits"
    first=0
  else
    shared="$(comm -12 <(printf '%s\n' "$shared") <(printf '%s\n' "$commits"))"
  fi
done

[ -n "$shared" ] || fail "$* were deployed to staging by different commits. Promote images from one staging run."
note "Deployed to staging together by $(printf '%s' "$shared" | tr '\n' ' ')"
printf '%s\n' "$shared"
