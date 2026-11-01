#!/bin/sh
# Runs export.sh once a day at BACKUP_AT (default 03:00) in BACKUP_TZ (default Europe/Paris), as the container's
# unprivileged user (busybox crond needs root). A container that was down at that hour exports when it starts again,
# unless today's export already succeeded: a deploy does not add a second export to the day.
# Every 30 seconds it also picks up a request to export now (REG-24): the owner asks through the API, which only
# inserts a row in backup_requests; this loop marks the waiting requests picked and runs the same export.sh, never
# two at once (the loop is the only one to run it). A request is picked once: a failed export is not retried from it.
set -eu

at=${BACKUP_AT:-03:00}
zone=${BACKUP_TZ:-Europe/Paris}
at_minutes=$(echo "$at" | tr -d :)
last=""

recent=$(psql "$BACKUP_DATABASE_URL" -X -q -A -t -v at="$at" -v zone="$zone" <<'SQL' || echo f
select exists (select from backup_runs where status = 'succeeded'
  and started_at >= (date_trunc('day', now() at time zone :'zone') + :'at'::time) at time zone :'zone');
SQL
)
if [ "$recent" = t ]; then last=$(TZ=$zone date +%F); fi

echo "backup: daily export at $at ($zone)"
while true; do
  today=$(TZ=$zone date +%F)
  now_minutes=$(TZ=$zone date +%H%M)
  if [ "$today" != "$last" ] && [ "$now_minutes" -ge "$at_minutes" ]; then
    last=$today
    /app/export.sh || echo "backup: export failed, next try tomorrow at $at" >&2
  fi
  asked=$(psql "$BACKUP_DATABASE_URL" -X -q -A -t -c \
    "update backup_requests set picked_at = now() where picked_at is null returning id" || true)
  if [ -n "$asked" ]; then
    echo "backup: export asked from the dashboard"
    /app/export.sh || echo "backup: asked export failed" >&2
  fi
  sleep 30
done
