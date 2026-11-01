#!/bin/sh
# Daily export of the production database (ADR 0028, OPS-02). One run:
#   1. a `running` row in backup_runs;
#   2. a snapshot held open by a psql session, so that the dump and the row counts see the same instant;
#   3. pg_dump --format=custom on that snapshot, without the data of session, verification and rate_limit_counters;
#   4. pg_restore --list: an unreadable dump never leaves as a success;
#   5. dump + manifest (row counts, pg_dump version) in one tar, encrypted with age to a public key only;
#   6. upload (s3 in production, a local folder in CI), then the row turns `succeeded` with size and SHA-256.
# Any failure turns the row `failed` with the step's name (never data), and the plaintext never outlives the run.
set -eu

: "${BACKUP_DATABASE_URL:?}"

work=$(mktemp -d)
run_id=""
holder=""
step="start"

sql() {
  psql "$BACKUP_DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 "$@"
}

# A hex digest as the base64 of its bytes, the form S3's checksum headers take (POSIX printf, no xxd needed).
hex_to_base64() {
  for byte in $(printf '%s' "$1" | sed 's/../& /g'); do
    # shellcheck disable=SC2059 # the format is the octal escape of one byte, built on purpose.
    printf "\\$(printf '%03o' "0x$byte")"
  done | base64 | tr -d '\n'
}

finish() {
  status=$?
  if [ -n "$holder" ]; then
    exec 3>&-
    kill "$holder" 2>/dev/null || true
  fi
  rm -rf "$work"
  if [ "$status" -ne 0 ] && [ -n "$run_id" ]; then
    sql -v id="$run_id" -v step="$step" <<'SQL' || true
update backup_runs set status = 'failed', finished_at = now(), error = 'failed at step ' || :'step'
where id = :'id'::uuid;
SQL
    echo "backup: failed at step $step" >&2
  fi
  exit "$status"
}
trap finish EXIT INT TERM

step="record"
run_id=$(sql -c "insert into backup_runs (started_at, status) values (now(), 'running') returning id")

# Checked once the run is recorded: a missing setting in production is a failed run that the alert sees.
step="settings"
: "${BACKUP_AGE_RECIPIENT:?}" "${BACKUP_TARGET:?}"

# The tables whose data stays out (ADR 0028 § 2), and the counts that the restore check compares.
excluded="session verification rate_limit_counters"
exclude_args=""
for table in $excluded; do exclude_args="$exclude_args --exclude-table-data=public.$table"; done
counts_sql="select coalesce(json_object_agg(table_name, (xpath('/row/c/text()',
  query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint
  order by table_name), '{}') from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
    and table_name not in ('session', 'verification', 'rate_limit_counters', 'backup_runs', 'restore_tests');"

step="snapshot"
mkfifo "$work/in"
sql <"$work/in" >"$work/out" &
holder=$!
exec 3>"$work/in"
echo "begin isolation level repeatable read, read only; select pg_export_snapshot();" >&3
tries=0
until [ -s "$work/out" ]; do
  tries=$((tries + 1))
  [ "$tries" -le 300 ] || exit 1
  sleep 0.1
done
snapshot=$(head -n 1 "$work/out")

step="dump"
mkdir "$work/export"
# shellcheck disable=SC2086 # exclude_args is a list of flags.
pg_dump "$BACKUP_DATABASE_URL" --format=custom --no-owner --snapshot="$snapshot" $exclude_args \
  --file="$work/export/nirvana.dump"

step="count"
echo "$counts_sql" >&3
echo "commit;" >&3
exec 3>&-
wait "$holder"
holder=""
counts=$(sed -n 2p "$work/out")
[ -n "$counts" ] || exit 1

step="verify"
pg_restore --list "$work/export/nirvana.dump" >/dev/null
dump_version=$(pg_dump --version)
printf '{"pg_dump":"%s","row_counts":%s}\n' "$dump_version" "$counts" >"$work/export/manifest.json"

step="encrypt"
name="nirvana-$(date -u +%Y%m%dT%H%M%SZ).tar.age"
tar -C "$work/export" -cf - nirvana.dump manifest.json | age -r "$BACKUP_AGE_RECIPIENT" -o "$work/$name"
rm -rf "$work/export"
size=$(wc -c <"$work/$name" | tr -d ' ')
sha256=$(sha256sum "$work/$name" | cut -d ' ' -f 1)

step="upload"
case "$BACKUP_TARGET" in
  s3)
    : "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_S3_REGION:?}" "${BACKUP_S3_BUCKET:?}"
    : "${BACKUP_S3_ACCESS_KEY_ID:?}" "${BACKUP_S3_SECRET_ACCESS_KEY:?}"
    object="backups/$name"
    # A bucket with Object Lock refuses a PUT without an integrity checksum. Both forms are sent: the SHA-256 the
    # bucket checks and keeps, and Content-MD5 for a provider that still asks for it. Both are signed (SigV4).
    md5=$(md5sum "$work/$name" | cut -d ' ' -f 1)
    # The credentials go through stdin, never the command line (ps would show them).
    printf 'user = "%s:%s"\n' "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" |
      curl --config - --fail-with-body --silent --show-error --max-time 900 \
        --aws-sigv4 "aws:amz:$BACKUP_S3_REGION:s3" \
        --header "x-amz-checksum-sha256: $(hex_to_base64 "$sha256")" \
        --header "Content-MD5: $(hex_to_base64 "$md5")" \
        --upload-file "$work/$name" "$BACKUP_S3_ENDPOINT/$BACKUP_S3_BUCKET/$object" >/dev/null
    ;;
  local)
    : "${BACKUP_LOCAL_DIR:?}"
    object="$name"
    cp "$work/$name" "$BACKUP_LOCAL_DIR/$name"
    ;;
  *)
    echo "backup: BACKUP_TARGET must be s3 or local" >&2
    exit 1
    ;;
esac

step="finish"
sql -v id="$run_id" -v object="$object" -v size="$size" -v sha="$sha256" -v version="$dump_version" \
  -v counts="$counts" <<'SQL'
update backup_runs set status = 'succeeded', finished_at = now(), object_key = :'object', size_bytes = :'size'::bigint,
  sha256 = :'sha', pg_dump_version = :'version', row_counts = :'counts'::jsonb
where id = :'id'::uuid;
SQL
echo "backup: $object ($size bytes, sha256 $sha256)"
