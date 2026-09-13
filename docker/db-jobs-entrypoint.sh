#!/bin/sh
# Entrypoint of the db-jobs image (docker/db-jobs.Dockerfile).
#
#   db-jobs migrate          run packages/db migrations
#   db-jobs registry-load    load registry/ into registry.parts
#   db-jobs <command…>       run anything else, e.g. node packages/db/dist/migrate.js
#   db-jobs                  pick from CLOUD_RUN_JOB: db-migrate or registry-load
#
# Terraform owns each job's command and args (docs/adr/0005) and sets neither,
# so on Cloud Run the job's own name selects the task. Each task execs node, so
# signals and the exit status reach Cloud Run unchanged.
set -eu
cd /app

task="${1:-${CLOUD_RUN_JOB:-}}"
case "$task" in
  migrate | db-migrate) exec node packages/db/dist/migrate.js ;;
  registry-load) exec node registry/dist/load.js ;;
esac

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

printf '{"severity":"ERROR","message":"db-jobs: no task. Pass migrate or registry-load, or run as the Cloud Run job db-migrate or registry-load.","cloudRunJob":"%s"}\n' "${CLOUD_RUN_JOB:-}"
exit 64
