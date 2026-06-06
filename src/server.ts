import { app } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { runMigrations } from './migrations/runner';
import { startWorker, stopWorker } from './worker';
import { eventBus } from './shared/eventBus';

const port = env.PORT;

// 1. Run migrations before starting server
try {
  runMigrations();
} catch (err) {
  logger.fatal(err, 'Failed to run database migrations. Exiting server.');
  process.exit(1);
}

// 2. Replay unprocessed events on startup
try {
  eventBus.replayUnprocessed();
} catch (err) {
  logger.error(err, 'Failed to replay unprocessed events on startup');
}

// 3. Start periodic background worker loop
startWorker();

// 3. Bind server to port
const server = app.listen(port, () => {
  logger.info({ port, env: env.NODE_ENV }, '🚀 Open API ERP server successfully started.');
});

// Handle graceful shutdown
const gracefulShutdown = () => {
  logger.info('Shutting down server gracefully...');
  stopWorker();
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
