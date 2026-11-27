import { createApp } from './composition-root';
import { loadConfig } from './config';
import { logCrashes } from './crash';
import { createHeartbeatPing } from './heartbeat-ping';
import { createLogger } from './logger';
import { reportCrashes } from './observability/crash-reports';
import { startErrorReporting } from './observability/error-reporter';
import { exitGracefully, SHUTDOWN_FLUSH_MS } from './shutdown';
import { startWorker } from './worker-runner';

/** Worker entry point (`node dist/worker.js`): same composition root as the API, no HTTP. */
const config = loadConfig();
const logger = createLogger(config);
// An error nobody caught is written to the log before Node exits (`crash.ts`).
logCrashes(logger);
// Production errors reach Sentry, scrubbed (OPS-18); without SENTRY_DSN nothing starts and nothing leaves.
const errorReporter = startErrorReporting(config);
reportCrashes(errorReporter, logger, 'worker');
// Before anything starts: a SIGTERM during the start is kept for the stop below (`shutdown.ts`).
const graceful = exitGracefully(logger);
const app = await createApp(config, logger, { withPlayground: false, errorReporter });
const worker = await startWorker(app, {
  logger,
  concurrency: config.WORKER_CONCURRENCY,
  release: config.RELEASE,
  // A watcher outside the machine learns that this worker lives; silent, it writes to the owner (OPS-22).
  ...(config.WORKER_HEARTBEAT_URL === undefined
    ? {}
    : { heartbeatPing: createHeartbeatPing(config.WORKER_HEARTBEAT_URL, logger) }),
});

graceful.stopWith(async () => {
  await worker.stop();
  await app.shutdown();
  // What is still pending leaves last, bounded: the stop stays under Docker's 30 s (shutdown.ts).
  await errorReporter.flush(SHUTDOWN_FLUSH_MS);
});
