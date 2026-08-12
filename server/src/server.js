import config from './config/index.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import createApp from './app.js';

async function start() {
  await connectDatabase();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[server] HMS API listening on http://localhost:${config.port} (${config.env})`);
    console.log(`[server] health check: http://localhost:${config.port}/api/v1/health`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[server] ${signal} received — shutting down`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    // Don't hang forever if a connection refuses to close.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandled promise rejection:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('[server] uncaught exception — exiting:', error);
    process.exit(1);
  });
}

start().catch((error) => {
  console.error('[server] failed to start:', error.message);
  process.exit(1);
});
