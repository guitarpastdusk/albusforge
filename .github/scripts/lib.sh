# Shared helpers for the deploy scripts. Sourced, not run.
#
# Callers set REPO (the Artifact Registry repository path), the image, and what
# runs it:
#   SERVICE=<name>             a Cloud Run service. The image is $REPO/$SERVICE
#                              unless IMAGE names another.
#   JOBS="<job> <job>"         Cloud Run jobs that all run IMAGE. IMAGE is
#                              required, and SERVICE is ignored.
#   IMAGE=<name> alone         for scripts that only read the registry
#                              (require-staging-deployed.sh).
# deploy-web sets only REPO and SERVICE=web.
: "${REPO:?REPO is required}"
JOBS="${JOBS:-}"
if [ -n "$JOBS" ]; then
  : "${IMAGE:?IMAGE is required with JOBS}"
else
  IMAGE="${IMAGE:-${SERVICE:?SERVICE is required}}"
fi

note() { echo "$*" >&2; }
fail() {
  echo "::error::$*" >&2
  exit 1
}
require_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]] || fail "not a commit SHA: '$1'"; }
require_digest() { [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "digest must match ^sha256:[0-9a-f]{64}\$, got '$1'"; }

# serving_image PROJECT
# Prints the image of the revision serving all of $SERVICE's traffic in PROJECT.
# That is what actually runs, unlike the service spec's desired image: a failed
# deploy updates the spec, but traffic stays on the previous ready revision, and
# Cloud Run only routes traffic to ready revisions.
# Returns 4 if no single revision serves 100% (split or no traffic), 2 if gcloud
# or parsing fails. Needs REGION.
serving_image() {
  local project="$1" svc rev img
  : "${REGION:?REGION is required}"
  svc="$(gcloud run services describe "$SERVICE" --project "$project" --region "$REGION" --format=json)" || return 2
  rev="$(printf '%s' "$svc" | jq -r '
    . as $s
    | [ ($s.status.traffic // [])[] | select((.percent // 0) > 0) ]
    | if length == 1 and .[0].percent == 100
      then .[0].revisionName // (if .[0].latestRevision == true then $s.status.latestReadyRevisionName else null end) // ""
      else "" end')" || return 2
  [ -n "$rev" ] || return 4
  img="$(gcloud run revisions describe "$rev" --project "$project" --region "$REGION" \
    --format='value(spec.containers[0].image)')" || return 2
  [ -n "$img" ] || return 2
  printf '%s\n' "$img"
}

# job_image PROJECT JOB
# Prints the image of JOB's most recent successful execution in PROJECT. That is
# what last ran to completion, unlike the job's template: a job updated to a new
# image whose execution then failed still names the new image.
# Returns 4 if no execution has succeeded, 2 if gcloud or parsing fails. Needs
# REGION.
job_image() {
  local project="$1" job="$2" json img
  : "${REGION:?REGION is required}"
  json="$(gcloud run jobs executions list --job "$job" --project "$project" --region "$REGION" --format=json)" || return 2
  img="$(printf '%s' "$json" | jq -r '
    [ .[] | select(any((.status.conditions // [])[]; .type == "Completed" and .status == "True")) ]
    | sort_by(.metadata.creationTimestamp // "")
    | if length == 0 then "" else (last | .spec.template.spec.containers[0].image // "__NO_IMAGE__") end')" || return 2
  [ -n "$img" ] || return 4
  [ "$img" != "__NO_IMAGE__" ] || return 2
  printf '%s\n' "$img"
}

# image_tags DIGEST
# Prints the tag names on DIGEST in $REPO/$IMAGE, one per line.
# Returns 3 if the digest isn't in the repository, 2 if the listing fails.
# Accepts tags as a comma-separated string or an array, as bare names or full
# resource names, and versions as a digest or a .../versions/<digest> path.
image_tags() {
  local digest="$1" json out
  json="$(gcloud artifacts docker images list "$REPO/$IMAGE" --include-tags --format=json)" || return 2
  out="$(printf '%s' "$json" | jq -r --arg d "$digest" '
    [ .[] | select((.version // "") as $v | $v == $d or ($v | endswith("/" + $d)) or ($v | endswith("@" + $d))) ] as $m
    | if ($m | length) == 0 then "__NOT_FOUND__"
      else $m[] | (.tags // []) | (if type == "string" then split(",") else . end) | .[]
        | gsub("^\\s+|\\s+$"; "") | select(length > 0) | sub("^.*[/:]"; "")
      end')" || return 2
  if [ "$out" = "__NOT_FOUND__" ]; then return 3; fi
  if [ -n "$out" ]; then printf '%s\n' "$out"; fi
  return 0
}
