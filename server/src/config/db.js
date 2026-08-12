import mongoose from 'mongoose';
import config from './index.js';

mongoose.set('strictQuery', true);

/**
 * Connect to MongoDB. Retries with linear backoff so a container that starts
 * before the database does not crash-loop.
 */
export async function connectDatabase({ retries = 5, delayMs = 3000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await mongoose.connect(config.mongoUri, {
        serverSelectionTimeoutMS: 10000,
        autoIndex: !config.isProduction, // build indexes in dev; use migrations in prod
      });
      const { host, name } = mongoose.connection;
      console.log(`[db] connected to ${host}/${name}`);
      return mongoose.connection;
    } catch (error) {
      const isLast = attempt === retries;
      console.error(
        `[db] connection attempt ${attempt}/${retries} failed: ${error.message}`,
      );
      if (isLast) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

export async function disconnectDatabase() {
  await mongoose.connection.close(false);
  console.log('[db] connection closed');
}

mongoose.connection.on('error', (error) => {
  console.error('[db] runtime error:', error.message);
});

mongoose.connection.on('disconnected', () => {
  console.warn('[db] disconnected');
});

export default connectDatabase;
