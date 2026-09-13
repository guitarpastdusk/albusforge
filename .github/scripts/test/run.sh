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
# Behaviour comes from files in $STUB: service.json, revisions/<name> (that
# revision's image), images.json (or images-<image>.json for one image),
# images_fail, executions/<job>.json, executions_fail. Every call is appended to
# $STUB/calls.
mkdir -p "$work/bin"
cat >"$work/bin/gcloud" <<'STUB_EOF'
#!/usr/bin/env bash
echo "$*" >>"$STUB/calls"
case "$*" in
  "run services describe"*)
    cat "$STUB/service.json" ;;
  "run revisions describe"*)
    if [ -f "$STUB/revisions/$4" ]; then cat "$STUB/revisions/$4"; else echo "ERROR: revision $4 not found" >&2; exit 1; fi ;;
  "run jobs executions list --job "*)
    if [ -f "$STUB/executions_fail" ]; then echo "ERROR: (gcloud) PERMISSION_DENIED" >&2; exit 1; fi
    if [ -f "$STUB/executions/$6.json" ]; then cat "$STUB/executions/$6.json"; else echo "ERROR: job $6 not found" >&2; exit 1; fi ;;
  "artifacts docker images list"*)
    if [ -f "$STUB/images_fail" ]; then echo "ERROR: (gcloud) PERMISSION_DENIED" >&2; exit 1; fi
    if [ -f "$STUB/images-${5##*/}.json" ]; then cat "$STUB/images-${5##*/}.json"; else cat "$STUB/images.json"; fi ;;
  "artifacts docker tags add"*)
    echo "Added tag." >&2 ;;
  # Workflow-context tests (below) run whole workflows' steps.
  "auth print-access-token"*)
    echo "stub-token" ;;
  "run jobs describe"*)
    echo "$4" ;;
  "run jobs update"* | "run jobs execute"* | "run deploy"*)
    echo "stub: $*" >&2 ;;
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
image2="$REPO/$SERVICE@$d2"

# --- helpers ------------------------------------------------------------------------
case_no=0
setup() { # setup NAME: a fresh stub for one case
  name="$1"
  case_no=$((case_no + 1))
  STUB="$work/stub-$case_no"
  mkdir -p "$STUB/revisions" "$STUB/executions"
  : >"$STUB/calls"
  echo '[]' >"$STUB/images.json"
  echo '{}' >"$STUB/service.json"
  export STUB GITHUB_SHA="$C" SERVICE=web
  unset JOBS IMAGE
}
# serving IMAGE [DESIRED]: web-00002 runs IMAGE and serves 100% of traffic. The
# spec's desired image is DESIRED (default IMAGE), as after a failed deploy.
serving() {
  local desired="${2:-$1}"
  printf '%s\n' "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"image\":\"$desired\"}]}}},\"status\":{\"latestCreatedRevisionName\":\"web-00003\",\"latestReadyRevisionName\":\"web-00002\",\"traffic\":[{\"revisionName\":\"web-00002\",\"percent\":100,\"latestRevision\":true}]}}" >"$STUB/service.json"
  printf '%s\n' "$1" >"$STUB/revisions/web-00002"
}
images() { printf '%s\n' "$1" >"$STUB/images.json"; }
tagged() { images "[{\"package\":\"$REPO/$SERVICE\",\"version\":\"$1\",\"tags\":\"$2\"}]"; }
run() { # run SCRIPT [ARG...]: sets out, err, code
  local script="$1"
  shift
  out="$(cd "$repo" && bash "$scripts/$script" "$@" 2>"$STUB/err")"
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

setup "freshness: staging already serves this commit -> skip"
serving "$image1"
tagged "$d1" "$C,staging-deployed-$C"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=skip" ]'

setup "freshness: staging serves an ancestor -> deploy"
serving "$image1"
tagged "$d1" "$B,staging-deployed-$B"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=deploy" ]'

setup "freshness: staging serves a newer commit -> refuse"
serving "$image1"
tagged "$d1" "$C"
export GITHUB_SHA="$B"
run staging-freshness.sh
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "Refusing to roll back"'

setup "freshness: staging serves a diverged commit -> refuse"
serving "$image1"
tagged "$d1" "$D"
run staging-freshness.sh
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "Refusing to roll back"'

setup "freshness: staging serves a commit not in history -> refuse"
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

setup "freshness: retry after a failed deploy reads the serving revision, not the desired image -> deploy"
# C's deploy updated the desired image to image1, but its revision never became
# ready, so image2 (commit B) still serves. The retry must deploy, not skip.
serving "$image2" "$image1"
images "[{\"version\":\"$d1\",\"tags\":\"$C\"},{\"version\":\"$d2\",\"tags\":\"$B,staging-deployed-$B\"}]"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=deploy" ]'

setup "freshness: traffic split across revisions -> refuse"
printf '%s\n' '{"status":{"traffic":[{"revisionName":"web-00001","percent":50},{"revisionName":"web-00002","percent":50}]}}' >"$STUB/service.json"
printf '%s\n' "$image2" >"$STUB/revisions/web-00001"
printf '%s\n' "$image1" >"$STUB/revisions/web-00002"
run staging-freshness.sh
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "No single ready revision"'

setup "freshness: latest-revision traffic without a name uses latestReadyRevisionName"
printf '%s\n' '{"status":{"latestReadyRevisionName":"web-00002","traffic":[{"percent":100,"latestRevision":true}]}}' >"$STUB/service.json"
printf '%s\n' "$image1" >"$STUB/revisions/web-00002"
tagged "$d1" "$B"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=deploy" ]'

setup "freshness: the serving revision can't be read -> refuse"
printf '%s\n' '{"status":{"traffic":[{"revisionName":"web-00009","percent":100}]}}' >"$STUB/service.json"
run staging-freshness.sh
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "Could not read the revision"'

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
setup "mark: staging serves the digest -> adds staging-deployed-<commit>"
serving "$image1"
tagged "$d1" "$C"
run mark-staging-deployed.sh "$d1"
expect '[ "$code" = 0 ] && called "artifacts docker tags add $image1 $REPO/$SERVICE:staging-deployed-$C"'

setup "mark: leaves an existing marker alone"
serving "$image1"
tagged "$d1" "$C,staging-deployed-$C"
run mark-staging-deployed.sh "$d1"
expect '[ "$code" = 0 ] && ! called "tags add"'

setup "mark: retry after a failed deploy (desired image1, serving image2) -> refuse, no tag"
serving "$image2" "$image1"
tagged "$d1" "$C"
run mark-staging-deployed.sh "$d1"
expect '[ "$code" = 1 ] && has "Not marking a digest staging" && ! called "tags add"'

setup "mark: same digest under another repository or host -> refuse, no tag"
serving "us-docker.pkg.dev/other-project/mirror/web@$d1"
tagged "$d1" "$C"
run mark-staging-deployed.sh "$d1"
expect '[ "$code" = 1 ] && has "Not marking a digest staging" && ! called "tags add"'

setup "mark: traffic split across revisions -> refuse, no tag"
printf '%s\n' '{"status":{"traffic":[{"revisionName":"web-00001","percent":90},{"revisionName":"web-00002","percent":10}]}}' >"$STUB/service.json"
printf '%s\n' "$image1" >"$STUB/revisions/web-00001"
printf '%s\n' "$image1" >"$STUB/revisions/web-00002"
tagged "$d1" "$C"
run mark-staging-deployed.sh "$d1"
expect '[ "$code" = 1 ] && has "Could not confirm" && ! called "tags add"'

setup "mark: a registry error fails instead of tagging blind"
serving "$image1"
touch "$STUB/images_fail"
run mark-staging-deployed.sh "$d1"
expect '[ "$code" = 1 ] && ! called "tags add"'

setup "retry regression: after a failed deploy, freshness deploys and mark can't tag the unserved digest"
serving "$image2" "$image1"
images "[{\"version\":\"$d1\",\"tags\":\"$C\"},{\"version\":\"$d2\",\"tags\":\"$B,staging-deployed-$B\"}]"
run staging-freshness.sh
fresh_out="$out"
run mark-staging-deployed.sh "$d1"
expect '[ "$fresh_out" = "action=deploy" ] && [ "$code" = 1 ] && ! called "tags add"'

# --- gateway: the service, and the db-jobs image the jobs run -------------------------
# gateway uses the same scripts with SERVICE=gateway, and JOBS + IMAGE for its jobs.
gw1="$REPO/gateway@$d1"
jobs1="$REPO/db-jobs@$d1"
jobs2="$REPO/db-jobs@$d2"

gateway_service() {
  export SERVICE=gateway
  unset JOBS IMAGE
}
gateway_jobs() {
  export JOBS="db-migrate registry-load" IMAGE=db-jobs
  unset SERVICE
}
# execution NAME CREATED IMAGE SUCCEEDED(True|False): one Cloud Run execution, as JSON.
execution() {
  printf '{"metadata":{"name":"%s","creationTimestamp":"%s"},"spec":{"template":{"spec":{"containers":[{"image":"%s"}]}}},"status":{"conditions":[{"type":"Completed","status":"%s"}]}}' "$1" "$2" "$3" "$4"
}
# executions JOB EXECUTION...: the job's execution list.
executions() {
  local job="$1" list="" item
  shift
  for item in "$@"; do list="${list:+$list,}$item"; done
  printf '[%s]\n' "$list" >"$STUB/executions/$job.json"
}

setup "gateway freshness: the service reads its own image repository"
gateway_service
serving "$gw1"
tagged "$d1" "$B,staging-deployed-$B"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=deploy" ] && called "run services describe gateway" && called "artifacts docker images list $REPO/gateway "'

setup "gateway freshness: the service's image from another repository is a placeholder -> deploy"
gateway_service
serving "$image1"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=deploy" ] && ! called "artifacts"'

setup "jobs freshness: jobs that have never run -> deploy"
gateway_jobs
executions db-migrate
executions registry-load
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=deploy" ] && ! called "artifacts"'

setup "jobs freshness: the sample image succeeded -> deploy"
gateway_jobs
executions db-migrate "$(execution db-migrate-a 2026-09-01T00:00:00Z us-docker.pkg.dev/cloudrun/container/job:latest True)"
executions registry-load
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=deploy" ]'

setup "jobs freshness: every job already ran this commit -> skip"
gateway_jobs
executions db-migrate "$(execution db-migrate-a 2026-09-01T00:00:00Z "$jobs1" True)"
executions registry-load "$(execution registry-load-a 2026-09-01T00:01:00Z "$jobs1" True)"
tagged "$d1" "$C,staging-deployed-$C"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=skip" ] && called "artifacts docker images list $REPO/db-jobs "'

setup "jobs freshness: one job ran this commit, the other an ancestor -> deploy"
gateway_jobs
executions db-migrate "$(execution db-migrate-a 2026-09-01T00:00:00Z "$jobs1" True)"
executions registry-load "$(execution registry-load-a 2026-09-01T00:01:00Z "$jobs2" True)"
images "[{\"version\":\"$d1\",\"tags\":\"$C\"},{\"version\":\"$d2\",\"tags\":\"$B\"}]"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=deploy" ]'

setup "jobs freshness: one job ran a newer commit -> refuse"
gateway_jobs
export GITHUB_SHA="$B"
executions db-migrate "$(execution db-migrate-a 2026-09-01T00:00:00Z "$jobs1" True)"
executions registry-load "$(execution registry-load-a 2026-09-01T00:01:00Z "$jobs2" True)"
images "[{\"version\":\"$d1\",\"tags\":\"$C\"},{\"version\":\"$d2\",\"tags\":\"$B\"}]"
run staging-freshness.sh
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "job db-migrate in albusforge-staging serves $C" && has "Refusing to roll back"'

setup "jobs freshness: a newer failed execution is ignored; the last success decides -> deploy"
# C's migration failed; B's is the last that succeeded. The retry must deploy, not skip.
gateway_jobs
executions db-migrate "$(execution db-migrate-b 2026-09-02T00:00:00Z "$jobs1" False)" "$(execution db-migrate-a 2026-09-01T00:00:00Z "$jobs2" True)"
executions registry-load "$(execution registry-load-a 2026-09-01T00:01:00Z "$jobs2" True)"
images "[{\"version\":\"$d1\",\"tags\":\"$C\"},{\"version\":\"$d2\",\"tags\":\"$B,staging-deployed-$B\"}]"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=deploy" ]'

setup "jobs freshness: the latest success is picked by creation time, not list order"
gateway_jobs
executions db-migrate "$(execution db-migrate-a 2026-09-01T00:00:00Z "$jobs2" True)" "$(execution db-migrate-b 2026-09-02T00:00:00Z "$jobs1" True)"
executions registry-load "$(execution registry-load-b 2026-09-02T00:01:00Z "$jobs1" True)"
images "[{\"version\":\"$d1\",\"tags\":\"$C\"},{\"version\":\"$d2\",\"tags\":\"$B\"}]"
run staging-freshness.sh
expect '[ "$code" = 0 ] && [ "$out" = "action=skip" ]'

setup "jobs freshness: an executions error never means deploy"
gateway_jobs
touch "$STUB/executions_fail"
run staging-freshness.sh
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "Could not read the executions of job db-migrate"'

setup "jobs freshness: JOBS without IMAGE is refused"
export JOBS="db-migrate registry-load"
unset IMAGE
run staging-freshness.sh
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "IMAGE is required with JOBS"'

setup "jobs mark: every job last succeeded with the digest -> tags db-jobs"
gateway_jobs
executions db-migrate "$(execution db-migrate-a 2026-09-01T00:00:00Z "$jobs1" True)"
executions registry-load "$(execution registry-load-a 2026-09-01T00:01:00Z "$jobs1" True)"
tagged "$d1" "$C"
run mark-staging-deployed.sh "$d1"
expect '[ "$code" = 0 ] && called "artifacts docker tags add $jobs1 $REPO/db-jobs:staging-deployed-$C"'

setup "jobs mark: one job last succeeded with another digest -> refuse, no tag"
gateway_jobs
executions db-migrate "$(execution db-migrate-a 2026-09-01T00:00:00Z "$jobs1" True)"
executions registry-load "$(execution registry-load-b 2026-09-02T00:00:00Z "$jobs1" False)" "$(execution registry-load-a 2026-09-01T00:01:00Z "$jobs2" True)"
tagged "$d1" "$C"
run mark-staging-deployed.sh "$d1"
expect '[ "$code" = 1 ] && has "Job registry-load in albusforge-staging last succeeded with $jobs2" && ! called "tags add"'

setup "jobs mark: a job that never succeeded -> refuse, no tag"
gateway_jobs
executions db-migrate "$(execution db-migrate-a 2026-09-01T00:00:00Z "$jobs1" True)"
executions registry-load "$(execution registry-load-a 2026-09-01T00:01:00Z "$jobs1" False)"
tagged "$d1" "$C"
run mark-staging-deployed.sh "$d1"
expect '[ "$code" = 1 ] && has "Could not confirm the latest successful execution of job registry-load" && ! called "tags add"'

setup "gateway mark: the service must serve the gateway image, not the same digest elsewhere"
gateway_service
serving "$image1"
tagged "$d1" "$C"
run mark-staging-deployed.sh "$d1"
expect '[ "$code" = 1 ] && has "not $gw1" && ! called "tags add"'

setup "promotion: IMAGE alone reads that image's repository"
export IMAGE=db-jobs
unset SERVICE
tagged "$d1" "$C,staging-deployed-$C"
run require-staging-deployed.sh "$d1"
expect '[ "$code" = 0 ] && called "artifacts docker images list $REPO/db-jobs "'

setup "same commit: gateway and db-jobs deployed by one commit -> allow, prints it"
printf '%s\n' "[{\"version\":\"$d1\",\"tags\":\"$C,staging-deployed-$B,staging-deployed-$C\"}]" >"$STUB/images-gateway.json"
printf '%s\n' "[{\"version\":\"$d2\",\"tags\":\"$C,staging-deployed-$C\"}]" >"$STUB/images-db-jobs.json"
run require-same-commit.sh "gateway@$d1" "db-jobs@$d2"
expect '[ "$code" = 0 ] && [ "$out" = "$C" ]'

setup "same commit: deployed by different commits -> refuse"
printf '%s\n' "[{\"version\":\"$d1\",\"tags\":\"$C,staging-deployed-$C\"}]" >"$STUB/images-gateway.json"
printf '%s\n' "[{\"version\":\"$d2\",\"tags\":\"$B,staging-deployed-$B\"}]" >"$STUB/images-db-jobs.json"
run require-same-commit.sh "gateway@$d1" "db-jobs@$d2"
expect '[ "$code" = 1 ] && [ -z "$out" ] && has "different commits"'

setup "same commit: one image never deployed to staging -> refuse"
printf '%s\n' "[{\"version\":\"$d1\",\"tags\":\"$C,staging-deployed-$C\"}]" >"$STUB/images-gateway.json"
printf '%s\n' "[{\"version\":\"$d2\",\"tags\":\"$C\"}]" >"$STUB/images-db-jobs.json"
run require-same-commit.sh "gateway@$d1" "db-jobs@$d2"
expect '[ "$code" = 1 ] && has "db-jobs@$d2 was never successfully deployed"'

setup "same commit: a malformed argument -> refuse before calling gcloud"
run require-same-commit.sh "gateway@$d1" "db-jobs:latest"
expect '[ "$code" = 1 ] && ! called "artifacts"'

# --- workflow context -------------------------------------------------------------------
# The scripts' own exit codes only matter if the workflow step that calls them
# fails too. These run a workflow's `run:` steps in order, exactly as written in
# the YAML, each under `bash -e` (what Actions runs when no shell is set, so
# without pipefail), stopping at the first failure as Actions does. `uses:`
# steps are skipped.
root="$(cd "$scripts/../.." && pwd)"

# workflow_steps FILE DIR: writes each run step's script to DIR/NN.sh and its name to DIR/NN.name.
# A step's own `env:` becomes exports at the top of its script, with
# `${{ inputs.X }}` read from $INPUT_X; any other expression makes the step exit 97.
workflow_steps() {
  awk -v out="$2" '
    function indent(s) { match(s, /[^ ]/); return RSTART - 1 }
    function flush() {
      if (has) { n++; f = sprintf("%s/%02d", out, n); printf "%s%s", envs, body > (f ".sh"); close(f ".sh"); print name > (f ".name"); close(f ".name") }
      body = ""; envs = ""; has = 0; inrun = 0; inenv = 0
    }
    {
      if (inrun) {
        if ($0 ~ /^ *$/) { body = body "\n"; next }
        if (indent($0) > runindent) {
          if (bodyindent < 0) bodyindent = indent($0)
          body = body substr($0, bodyindent + 1) "\n"; next
        }
        inrun = 0
      }
      if (inenv) {
        if ($0 ~ /^ *$/) next
        if (indent($0) > envindent) {
          kv = $0; sub(/^ */, "", kv)
          key = kv; sub(/:.*/, "", key)
          val = kv; sub(/^[^:]*: */, "", val)
          gsub(/[$][{][{] *inputs[.]/, "${INPUT_", val); gsub(/ *[}][}]/, "}", val)
          if (val ~ /[$][{][{]/) envs = envs "echo \"unsupported expression in env " key "\" >&2; exit 97\n"
          else envs = envs "export " key "=\"" val "\"\n"
          next
        }
        inenv = 0
      }
      if ($0 ~ /^ *- name: /) { flush(); stepindent = indent($0); name = $0; sub(/^ *- name: /, "", name); next }
      if ($0 ~ /^ *- uses: /) { flush(); stepindent = indent($0); name = ""; next }
      if ($0 ~ /^ *env: *$/ && indent($0) == stepindent + 2) { inenv = 1; envindent = indent($0); next }
      if ($0 ~ /^ *run: [|]$/) { inrun = 1; has = 1; runindent = indent($0); bodyindent = -1; next }
      if ($0 ~ /^ *run: /) { line = $0; sub(/^ *run: /, "", line); body = line "\n"; has = 1 }
    }
    END { flush() }
  ' "$1"
}

# run_workflow FILE: sets code (the failing step's status, or 0), err, and $STUB/steps (names of steps run).
run_workflow() {
  local dir="$STUB/workflow" step
  rm -rf "$dir"
  mkdir -p "$dir"
  : >"$STUB/steps"
  : >"$STUB/err"
  workflow_steps "$1" "$dir"
  code=0
  for step in "$dir"/*.sh; do
    cat "${step%.sh}.name" >>"$STUB/steps"
    (cd "$root" && bash -e "$step") >>"$STUB/out" 2>>"$STUB/err" || {
      code=$?
      break
    }
  done
  err="$(cat "$STUB/err")"
}
mutated() { grep -qE '^run (jobs update|jobs execute|deploy) ' "$STUB/calls"; }

# promote_gateway GATEWAY_TAGS JOBS_TAGS: prod env and inputs for promote-gateway.yml.
promote_gateway() {
  # Inputs reach the steps only through each step's own env:, as in Actions.
  export SERVICE=gateway JOBS_IMAGE=db-jobs JOB_NAMES="db-migrate registry-load" PROJECT=albusforge-prod \
    INPUT_digest="$d1" INPUT_jobs_digest="$d2" GITHUB_ACTOR=tester \
    GITHUB_STEP_SUMMARY="$STUB/summary" GITHUB_OUTPUT="$STUB/output" DEPLOYER=deploy-prod@example.com
  unset JOBS IMAGE DIGEST JOBS_DIGEST
  printf '%s\n' "[{\"version\":\"$d1\",\"tags\":\"$1\"}]" >"$STUB/images-gateway.json"
  printf '%s\n' "[{\"version\":\"$d2\",\"tags\":\"$2\"}]" >"$STUB/images-db-jobs.json"
}

setup "workflow: promote-gateway extracts its run steps"
workflow_steps "$root/.github/workflows/promote-gateway.yml" "$STUB"
expect '[ "$(cat "$STUB"/*.name | tr "\n" "|")" = "Validate digests|Verify GCP credentials|Require a successful staging deploy of both images|Require the Terraform-managed service and jobs|Run db-migrate|Run registry-load|Deploy gateway to prod|" ]'

setup "workflow: promote-gateway with a pair staging deployed together -> runs the jobs, then deploys"
promote_gateway "$C,staging-deployed-$C" "$C,staging-deployed-$C"
run_workflow "$root/.github/workflows/promote-gateway.yml"
expect '[ "$code" = 0 ] && [ "$(grep -E "^run (jobs update|jobs execute|deploy) " "$STUB/calls" | cut -d" " -f1-4 | tr "\n" "|")" = "run jobs update db-migrate|run jobs execute db-migrate|run jobs update registry-load|run jobs execute registry-load|run deploy gateway --image|" ] && called "run jobs update db-migrate --image $REPO/db-jobs@$d2" && called "run deploy gateway --image $REPO/gateway@$d1"'

setup "workflow: promote-gateway with images from different staging commits -> stops before any mutation"
# Each digest carries its own marker, so both single-image checks pass; only the pairing check fails.
promote_gateway "$C,staging-deployed-$C" "$B,staging-deployed-$B"
run_workflow "$root/.github/workflows/promote-gateway.yml"
expect '[ "$code" != 0 ] && has "different commits" && [ "$(tail -n 1 "$STUB/steps")" = "Require a successful staging deploy of both images" ] && ! mutated'

setup "workflow: promote-gateway with a jobs image never deployed to staging -> stops before any mutation"
promote_gateway "$C,staging-deployed-$C" "$C"
run_workflow "$root/.github/workflows/promote-gateway.yml"
expect '[ "$code" != 0 ] && has "never successfully deployed to staging" && ! mutated'

# A pipeline's status is its last command's unless pipefail is on, so a failing
# check piped into head/tee/grep passes under `bash -e`. Deploy and promote
# workflows either set `shell: bash` (which adds pipefail) or pipe nothing.
for wf in "$root"/.github/workflows/deploy-*.yml "$root"/.github/workflows/promote-*.yml; do
  setup "workflow: $(basename "$wf") pipes nothing, or runs with pipefail"
  workflow_steps "$wf" "$STUB"
  piped="$(cat "$STUB"/*.sh | grep -nE '(^|[^|])[|]([^|]|$)' || true)"
  expect '[ -z "$piped" ] || grep -qE "^ +shell: bash$" "$wf"'
done

echo
echo "$passed passed, $failed failed"
[ "$failed" = 0 ]
