# syntax=docker/dockerfile:1.7
# Dashboard image (ADR 0027, docs/runbooks/deploy.md): the built SPA served by nginx, which also forwards /v1 to
# the API so that the session cookie stays first-party (same origin, as the Vite proxy does in development).
# Build from the repository root: docker build -f apps/web/Dockerfile .
# Same Node as .nvmrc.
ARG NODE_IMAGE=node:22.22.0-alpine3.23
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29-alpine

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter nirvana --filter "@nirvana/web..."
RUN pnpm turbo run build --filter=@nirvana/web

FROM ${NGINX_IMAGE} AS runtime
# Where nginx forwards /v1: the API service on the deployment's private network.
ENV API_UPSTREAM=api:3000
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
