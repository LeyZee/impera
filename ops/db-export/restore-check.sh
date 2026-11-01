#!/bin/sh
# Restores one encrypted export into an EMPTY database and checks it (ADR 0028 § 6). Used by the CI on every PR and
# by the quarterly test on Charles's PC, in a throwaway container. Nothing restored here can reach the outside:
#   - the graphile_worker queue is emptied right after pg_restore, before anything could start a worker;
#   - the application's encryption keys are never given to this script nor to the API started on the copy.
# Usage: restore-check.sh <export.tar.age> <age identity file> <empty database URL>
# Prints the SHA-256 of the export and the tables whose row count differs from the manifest; exits 1 on a difference.
set -eu

export_file=$1
identity=$2
target=$3

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

sql() {
  psql "$target" -X -q -A -t -v ON_ERROR_STOP=1 "$@"
}

echo "export sha256: $(sha256sum "$export_file" | cut -d ' ' -f 1)"

age -d -i "$identity" "$export_file" | tar -C "$work" -xf -

# The grants of the dump name nirvana_app: the role must exist, without login, on a throwaway server.
sql <<'SQL'
do $$ begin
  if not exists (select from pg_roles where rolname = 'nirvana_app') then create role nirvana_app nologin; end if;
end $$;
SQL

started=$(date +%s)
pg_restore --no-owner --exit-on-error --single-transaction --dbname="$target" "$work/nirvana.dump"
rm -f "$work/nirvana.dump"

# Every queued or scheduled job of production goes: a worker on this copy must have nothing to send.
sql <<'SQL'
do $$ declare t text; begin
  for t in select format('%I.%I', table_schema, table_name) from information_schema.tables
           where table_schema = 'graphile_worker' and table_type = 'BASE TABLE' and table_name <> 'migrations'
  loop execute 'truncate ' || t || ' cascade'; end loop;
end $$;
SQL
echo "restored in $(($(date +%s) - started)) s, worker queue emptied"

expected=$(sed -e 's/.*"row_counts"://' -e 's/}$//' "$work/manifest.json")
mismatches=$(sql -v expected="$expected" <<'SQL'
select coalesce(string_agg(e.key || ' (' || e.value || ' expected, ' || coalesce(a.n::text, 'missing') || ' restored)',
  ', ' order by e.key), '')
from json_each_text(:'expected'::json) e
left join lateral (
  select (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', e.key), false, true, '')))[1]::text::bigint as n
  where exists (select from information_schema.tables where table_schema = 'public' and table_name = e.key)
) a on true
where a.n is distinct from e.value::bigint;
SQL
)
if [ -n "$mismatches" ]; then
  echo "row counts differ: $mismatches"
  exit 1
fi
tables=$(echo "select count(*) from json_each_text(:'expected'::json);" | sql -v expected="$expected")
echo "row counts: all $tables tables match"
