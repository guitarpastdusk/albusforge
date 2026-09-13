#!/usr/bin/env bash
# A dispatch may release only a commit on main whose latest push CI passed.
# With DIGEST, recover the exact source from its immutable staging marker.
set -euo pipefail
if [ -n "${DIGEST:-}" ]; then
  . "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
  require_digest "$DIGEST"
  tags="$(image_tags "$DIGEST")"
  commits="$(printf '%s\n' "$tags" | sed -nE 's/^staging-deployed-([0-9a-f]{40})$/\1/p')"
  [ -n "$commits" ] || fail "No staging evidence for this digest"
  # Several commits can build identical bytes. Require all marker sources to
  # pass; no success can be selected to conceal a newer failed certification.
else
  commits="${GITHUB_SHA:?GITHUB_SHA required}"
fi
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"
for commit in $commits; do
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || exit 1
  git merge-base --is-ancestor "$commit" origin/main || {
    echo "::error::Release source is not on main"; exit 1;
  }
  result="$(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${commit}&event=push&per_page=100" \
    --jq '[.workflow_runs[] | select(.head_sha == "'"$commit"'" and .event == "push")] | sort_by(.run_number) | last | [.status, .conclusion] | @tsv')"
  [ "$result" = $'completed\tsuccess' ] || {
    echo "::error::Latest exact-source push CI has not passed for ${commit}"; exit 1;
  }
done
