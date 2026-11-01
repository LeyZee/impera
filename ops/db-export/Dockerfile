# The `backup` service (ADR 0028, OPS-02): a daily pg_dump of the production database, encrypted with age to a public
# key, sent to an S3 bucket at another provider than Neon. pg_dump's major version follows Neon's (16): a newer server
# makes the dump fail loudly, never a silently wrong file. Build from the repository root:
#   docker build -f ops/db-export/Dockerfile ops/db-export
FROM postgres:16.15-alpine3.24

# age encrypts, curl uploads (SigV4), tzdata gives the schedule its time zone. No dependency beyond these.
RUN apk add --no-cache age curl tzdata

WORKDIR /app
COPY --chmod=0555 export.sh restore-check.sh schedule.sh ./

# The image's own unprivileged user; the scripts write only under mktemp's directory.
USER postgres
ENTRYPOINT []
CMD ["/app/schedule.sh"]
