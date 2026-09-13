#!/usr/bin/env bash
# Tests for the deploy scripts, against a stub gcloud and a throwaway git repo.
# Run from anywhere: bash .github/scripts/test/run.sh
# Needs bash, git and jq. Works with macOS's bash 3.2, so no `set -u`.
set -o pipefail

scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
passed=0
failed=0

# --- stub gcloud -----------------------------------------------------------------
# Behaviour comes from files in $STUB: service_image, images.json, images_fail.
# Every call is appended to $STUB/calls.
mkdir -p "$work/bin"
cat >"$work/bin/gcloud" <<'STUB_EOF'
#!/usr/bin/env bash
echo "$*" >>"$STUB/calls"
case "$*" in
  "run services describe"*)
    cat "$STUB/service_image" ;;
  "artifacts docker images list"*)
    if [ -f "$STUB/images_fail" ]; then echo "ERROR: (gcloud) PERMISSION_DENIED" >&2; exit 1; fi
    cat "$STUB/images.json" ;;
  "artifacts docker tags add"*)
    echo "Added tag." >&2 ;;
  *)
    echo "stub gcloud: unexpected call: $*" >&2; exit 99 ;;
esac
STUB_EOF
chmod +x "$work/bin/gcloud"
export PATH="$work/bin:$PATH"
export REPO=us-central1-docker.pkg.dev/albusforge-ci/albusforge SERVICE=web PROJECT=albusforge-staging REGION=us-central1

# --- history: A - B - C on the main line, D branches from A ----------------------
repo="$work/repo"
git init -q "$repo"
g() { git -C "$repo" -c user.name=test -c user.email=test@example.com "$@"; }
g commit -q --allow-empty -m A && A="$(g rev-parse HEAD)"
g commit -q --allow-empty -m B && B="$(g rev-parse HEAD)"
g commit -q --allow-empty -m C && C="$(g rev-parse HEAD)"
g checkout -q -b side "$A"
g commit -q --allow-empty -m D && D="$(g rev-parse HEAD)"
UNKNOWN=ffffffffffffffffffffffffffffffffffffffff

d1="sha256:$(printf '%064d' 1)"
d2="sha256:$(printf '%064d' 2)"
image1="$REPO/$SERVICE@$d1"

# --- helpers ------------------------------------------------------------------------
case_no=0
setup() { # setup NAME: a fresh stub for one case
  name="$1"
  case_no=$((case_no + 1))
  STUB="$work/stub-$case_no"
  mkdir -p "$STUB"
  : >"$STUB/calls"
  echo '[]' >"$STUB/images.json"
  export STUB GITHUB_SHA="$C"
}
serving() { printf '%s\n' "$1" >"$STUB/service_image"; }
images() { printf '%s\n' "$1" >"$STUB/images.json"; }
tagged() { images "[{\"package\":\"$REPO/$SERVICE\",\"version\":\"$1\",\"tags\":\"$2\"}]"; }
run() { # run SCRIPT [ARG]: sets out, err, code
  out="$(cd "$repo" && bash "$scripts/$1" ${2+"$2"} 2>"$STUB/err")"
  code=$?
  err="$(cat "$STUB/err")"
}
has() { case "$err" in *"$1"*) return 0 ;; *) return 1 ;; esac; }
called() { grep -qF -- "$1" "$STUB/calls"; }
expect() { # expect CONDITION
  if eval "$1"; then
    passed=$((passed + 1))
    echo "ok   - $name"
  else
    failed=$((failed + 1))
    echo "FAIL - $name"
    echo "       expected: $1"
    echo "       code=$code out=[$out]"
    echo "       err=[$err]"
  fi
}

# --- staging-freshness.sh -----------------------------------------------------------
setup "freshness: Terraform placeholder image -> deploy"
serving "us-docker.pkg.dev/cloudrun/container/hello"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=deploy" ]'

setup "freshness: staging already runs this commit -> skip"
serving "$image1"
tagged "$d1" "$C,staging-deployed-$C"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=skip" ]'

setup "freshness: staging runs an ancestor -> deploy"
serving "$image1"
tagged "$d1" "$B,staging-deployed-$B"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=deploy" ]'

setup "freshness: staging runs a newer commit -> refuse"
serving "$image1"
tagged "$d1" "$C"
export GITHUB_SHA="$B"
run staging-freshness.sh
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "Refusing to roll back"'

setup "freshness: staging runs a diverged commit -> refuse"
serving "$image1"
tagged "$d1" "$D"
run staging-freshness.sh
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "Refusing to roll back"'

setup "freshness: staging runs a commit not in history -> refuse"
serving "$image1"
tagged "$d1" "$UNKNOWN"
run staging-freshness.sh
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "Refusing to roll back"'

setup "freshness: staging image has no commit tag -> refuse"
serving "$image1"
tagged "$d1" "latest"
run staging-freshness.sh
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "no commit tag"'

setup "freshness: staging image isn't in the repository -> refuse"
serving "$image1"
tagged "$d2" "$B"
run staging-freshness.sh
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "not in"'

setup "freshness: array tags and resource names are understood"
serving "$image1"
images "[{\"version\":\"projects/p/locations/us-central1/repositories/albusforge/packages/web/versions/$d1\",\"tags\":[\"projects/p/locations/us-central1/repositories/albusforge/packages/web/tags/$B\"]}]"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=deploy" ]'

setup "freshness: a registry error never means deploy"
serving "$image1"
touch "$STUB/images_fail"
run staging-freshness.sh
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "Could not list tags"'

# --- require-staging-deployed.sh ----------------------------------------------------
setup "promotion: staging-deployed tag present -> allow"
tagged "$d1" "$C,staging-deployed-$C"
run require-staging-deployed.sh "$d1"
expect '[ "$code" = 0 ]'

setup "promotion: only the commit tag (pushed, staging deploy failed) -> refuse"
tagged "$d1" "$C"
run require-staging-deployed.sh "$d1"
expect '[ "$code" = 1 ] && has "never successfully deployed to staging"'

setup "promotion: digest not in the repository -> refuse"
tagged "$d2" "$C,staging-deployed-$C"
run require-staging-deployed.sh "$d1"
expect '[ "$code" = 1 ] && has "is not in"'

setup "promotion: malformed digest -> refuse before calling gcloud"
run require-staging-deployed.sh "latest"
expect '[ "$code" = 1 ] && has "digest must match" && ! called "artifacts"'

# --- mark-staging-deployed.sh -------------------------------------------------------
setup "mark: adds staging-deployed-<commit> to the digest"
tagged "$d1" "$C"
run mark-staging-deployed.sh "$d1"
expect '[ "$code" = 0 ] && called "artifacts docker tags add $image1 $REPO/$SERVICE:staging-deployed-$C"'

setup "mark: leaves an existing marker alone"
tagged "$d1" "$C,staging-deployed-$C"
run mark-staging-deployed.sh "$d1"
expect '[ "$code" = 0 ] && ! called "tags add"'

setup "mark: a registry error fails instead of tagging blind"
touch "$STUB/images_fail"
run mark-staging-deployed.sh "$d1"
expect '[ "$code" = 1 ] && ! called "tags add"'

echo
echo "$passed passed, $failed failed"
[ "$failed" = 0 ]
