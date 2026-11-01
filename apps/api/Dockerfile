# syntax=docker/dockerfile:1.7
# API and worker image (ADR 0027, docs/runbooks/deploy.md): one image, two commands.
#   API:    node dist/index.js   (default)
#   Worker: node dist/worker.js
# Build from the repository root: docker build -f apps/api/Dockerfile .
# Same Node as .nvmrc.
ARG NODE_IMAGE=node:22.22.0-alpine3.23

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /repo
# Dependencies first, from the lockfile alone: this layer survives source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter nirvana --filter "@nirvana/api..."
RUN pnpm turbo run build --filter=@nirvana/api
# Then the API's production dependencies alone, from the same lockfile: the workspace packages are bundled in dist
# (tsup.config.ts), so they are dev dependencies and stay out, with the build tools.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    rm -rf node_modules apps/*/node_modules packages/*/node_modules \
    && pnpm install --offline --frozen-lockfile --prod --ignore-scripts --filter @nirvana/api

FROM ${NODE_IMAGE} AS runtime
# ffmpeg/ffprobe read the fans' videos and voice notes (module media); tini forwards SIGTERM and reaps them.
RUN apk add --no-cache ffmpeg tini \
  && mkdir -p /data/training && chown node:node /data/training
ENV NODE_ENV=production PORT=3000 NIRVANA_TRAINING_DIR=/data/training
# The layout mirrors the repository: the bundled code reads `../migrations` (packages/db), `../prompts`
# (packages/llm) and `../../../personas` relative to dist.
WORKDIR /app/apps/api
COPY --from=build /repo/node_modules /app/node_modules
COPY --from=build /repo/apps/api/package.json ./package.json
COPY --from=build /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/migrations ./migrations
COPY --from=build /repo/packages/llm/prompts ./prompts
COPY --from=build /repo/personas/demo /app/personas/demo
USER node
VOLUME /data/training
EXPOSE 3000
# Liveness only: /ready also checks the migrations and the worker, Coolify reads it separately.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
