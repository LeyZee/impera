import { createApp } from './composition-root';
import { loadConfig } from './config';
import { logCrashes } from './crash';
import { createLogger } from './logger';
import { reportCrashes } from './observability/crash-reports';
import { startErrorReporting } from './observability/error-reporter';
import { buildServer } from './server';
import { exitGracefully, SHUTDOWN_FLUSH_MS } from './shutdown';
import { startWorker } from './worker-runner';

const config = loadConfig();
const logger = createLogger(config);
// An error nobody caught is written to the log before Node exits (`crash.ts`).
logCrashes(logger);
// Production errors reach Sentry, scrubbed (OPS-18); without SENTRY_DSN nothing starts and nothing leaves.
const errorReporter = startErrorReporting(config);
reportCrashes(errorReporter, logger, 'api');
// Before anything starts: a SIGTERM during the start is kept for the stop below (`shutdown.ts`).
const graceful = exitGracefully(logger);
const app = await createApp(config, logger, { errorReporter });
const server = await buildServer({
  config,
  logger,
  routes: app.routes,
  readiness: app.readiness,
  rateLimitStore: app.rateLimitStore,
  errorReporter: app.errorReporter,
});
// `pnpm dev`: one process for both (ADR 0004); production runs `dist/worker.js` separately.
const worker = config.IMPERA_INLINE_WORKER
  ? await startWorker(app, { logger, concurrency: config.WORKER_CONCURRENCY, release: config.RELEASE })
  : undefined;

graceful.stopWith(async () => {
  await server.close();
  await worker?.stop();
  await app.shutdown();
  // What is still pending leaves last, bounded: the stop stays under Docker's 30 s (shutdown.ts).
  await errorReporter.flush(SHUTDOWN_FLUSH_MS);
});

try {
  await server.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  logger.fatal({ err: error }, 'cannot listen');
  process.exit(1);
}
