# syntax=docker/dockerfile:1.7
# Dashboard image (ADR 0027, docs/runbooks/deploy.md): the built SPA served by nginx, which also forwards /v1 to
# the API so that the session cookie stays first-party (same origin, as the Vite proxy does in development).
# Build from the repository root: docker build -f apps/web/Dockerfile .
# Same Node as .nvmrc. Pinned by digest (security.md §5): the tag names it, the digest is what is pulled; Dependabot
# moves both.
ARG NODE_IMAGE=node:22.22.0-alpine3.23@sha256:e4bf2a82ad0a4037d28035ae71529873c069b13eb0455466ae0bc13363826e34
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter impera --filter "@impera/web..." --filter "@impera/extension..."
RUN pnpm turbo run build --filter=@impera/web
# The extension the team downloads from the guide (/aide/extension, ADR 0067): built with the CRM, so both ship together.
RUN pnpm --filter @impera/extension zip \
 && mkdir -p apps/web/dist/extension \
 && cp apps/extension/.output/impera.zip apps/web/dist/extension/impera.zip

FROM ${NGINX_IMAGE} AS runtime
# Where nginx forwards /v1: the API service on the deployment's private network.
ENV API_UPSTREAM=api:3000
# The media bucket's origin (S3_ENDPOINT), the only other one her phone talks to (CR-06 b); empty without a bucket.
ENV MEDIA_ORIGIN=""
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
