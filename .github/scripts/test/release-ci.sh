#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/git" <<'STUB'
#!/usr/bin/env bash
exit "${ANCESTRY_RESULT:-0}"
STUB
cat > "$tmp/gh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "${CI_RESULT}"
exit "${API_RESULT:-0}"
STUB
chmod +x "$tmp/git" "$tmp/gh"
export PATH="$tmp:$PATH" GITHUB_REPOSITORY=example/repo GITHUB_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export CI_RESULT=$'completed\tsuccess'
check() {
 local expected="$1" status=0
 shift
 env "$@" bash "$root/.github/scripts/require-release-ci.sh" >"$tmp/out" 2>&1 || status=$?
 if [ "$expected" = pass ]; then [ "$status" = 0 ]; else [ "$status" != 0 ]; fi
}
check pass
check fail ANCESTRY_RESULT=1
check fail CI_RESULT=$'completed\tfailure'
check fail CI_RESULT=$'in_progress\tnull'
check fail CI_RESULT=$'null\tnull'
check fail API_RESULT=1
check fail GITHUB_SHA=invalid
cat > "$tmp/gcloud" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "${IMAGE_RESULT}"
STUB
chmod +x "$tmp/gcloud"
export REPO=example/repository IMAGE=ask
export DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export IMAGE_RESULT='[{"version":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","tags":["staging-deployed-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]}]'
check pass
check fail CI_RESULT=$'completed\tfailure'
check fail IMAGE_RESULT='[]'
check fail IMAGE_RESULT='[{"version":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","tags":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]}]'
printf '11 release CI gate checks passed\n'
