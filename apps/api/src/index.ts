import { createApp } from './composition-root';
import { loadConfig } from './config';
import { logCrashes } from './crash';
import { createLogger } from './logger';
import { buildServer } from './server';
import { exitGracefully } from './shutdown';
import { startWorker } from './worker-runner';

const config = loadConfig();
const logger = createLogger(config);
// Before anything starts: a SIGTERM during the start is kept for the stop below (`shutdown.ts`).
// An error nobody caught is written to the log before Node exits (`crash.ts`).
logCrashes(logger);
const graceful = exitGracefully(logger);
const app = await createApp(config, logger);
const server = await buildServer({
  config,
  logger,
  routes: app.routes,
  readiness: app.readiness,
  rateLimitStore: app.rateLimitStore,
});
// `pnpm dev`: one process for both (ADR 0004); production runs `dist/worker.js` separately.
const worker = config.IMPERA_INLINE_WORKER
  ? await startWorker(app, { logger, concurrency: config.WORKER_CONCURRENCY, release: config.RELEASE })
  : undefined;

graceful.stopWith(async () => {
  await server.close();
  await worker?.stop();
  await app.shutdown();
});

try {
  await server.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (error) {
  logger.fatal({ err: error }, 'cannot listen');
  process.exit(1);
}
