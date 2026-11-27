# The `backup` service (ADR 0028, OPS-02): a daily pg_dump of the production database, encrypted with age to a public
# key, sent to an S3 bucket at another provider than the database. pg_dump's major version follows the production
# database's (Supabase, 17; ADR 0152 § 2): a newer server makes the dump fail loudly, never a silently wrong file.
# Build from the repository root:
#   docker build -f ops/db-export/Dockerfile ops/db-export
FROM postgres:19.0-alpine3.24@sha256:cac45fb483caee3668946088a1c0532db89d5285c28dbfeac889b4068296e06f

# age encrypts, curl uploads (SigV4), tzdata gives the schedule its time zone. No dependency beyond these.
RUN apk add --no-cache age curl tzdata

WORKDIR /app
COPY --chmod=0555 export.sh restore-check.sh schedule.sh ./

# The image's own unprivileged user; the scripts write only under mktemp's directory.
USER postgres
ENTRYPOINT []
CMD ["/app/schedule.sh"]
