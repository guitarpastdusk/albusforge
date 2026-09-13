# Shared helpers for the web deploy scripts. Sourced, not run.
# Callers set REPO (the Artifact Registry repository path) and SERVICE.
: "${REPO:?REPO is required}" "${SERVICE:?SERVICE is required}"

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

# image_tags DIGEST
# Prints the tag names on DIGEST in $REPO/$SERVICE, one per line.
# Returns 3 if the digest isn't in the repository, 2 if the listing fails.
# Accepts tags as a comma-separated string or an array, as bare names or full
# resource names, and versions as a digest or a .../versions/<digest> path.
image_tags() {
  local digest="$1" json out
  json="$(gcloud artifacts docker images list "$REPO/$SERVICE" --include-tags --format=json)" || return 2
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
