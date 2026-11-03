import { createApp } from './composition-root';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { exitGracefully } from './shutdown';
import { startWorker } from './worker-runner';

/** Worker entry point (`node dist/worker.js`): same composition root as the API, no HTTP. */
const config = loadConfig();
const logger = createLogger(config);
// Before anything starts: a SIGTERM during the start is kept for the stop below (`shutdown.ts`).
const graceful = exitGracefully(logger);
const app = await createApp(config, logger, { withPlayground: false });
const worker = await startWorker(app, {
  logger,
  concurrency: config.WORKER_CONCURRENCY,
  release: config.RELEASE,
});

graceful.stopWith(async () => {
  await worker.stop();
  await app.shutdown();
});
