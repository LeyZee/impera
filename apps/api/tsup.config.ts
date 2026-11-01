import { defineConfig } from 'tsup';

/**
 * Production build (ADR 0027): the workspace packages export their TypeScript sources, which plain Node cannot run,
 * so they are bundled in, with their own dependencies; the API's `dependencies` stay external and come from
 * `node_modules`. better-auth is bundled as well: installed on its own it would pull its optional peers (vitest,
 * drizzle-kit) into the production image. The operator scripts the deploy runbook calls are built too, so the image
 * needs neither tsx nor the sources.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    worker: 'src/worker.ts',
    'scripts/migrate': '../../packages/db/src/scripts/migrate.ts',
    'scripts/create-owner': 'src/scripts/create-owner.ts',
    'scripts/create-creator': 'src/scripts/create-creator.ts',
    'scripts/persona-validate': 'src/scripts/persona-validate.ts',
    'scripts/persona-load': 'src/scripts/persona-load.ts',
    'scripts/rebuild-projections': 'src/scripts/rebuild-projections.ts',
    'scripts/ops-kill-switch': 'src/scripts/ops-kill-switch.ts',
    'scripts/ops-revoke-sessions': 'src/scripts/ops-revoke-sessions.ts',
    'scripts/ops-reencrypt-sessions': 'src/scripts/ops-reencrypt-sessions.ts',
    'scripts/ops-reencrypt-credentials': 'src/scripts/ops-reencrypt-credentials.ts',
    'scripts/ops-check-keys': 'src/scripts/ops-check-keys.ts',
  },
  format: 'esm',
  target: 'node22',
  clean: true,
  noExternal: [/^@nirvana\//, /^better-auth(\/|$)/],
  // Bundled CommonJS code (the AI SDK's dependencies) calls `require`, which an ES module does not have.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
