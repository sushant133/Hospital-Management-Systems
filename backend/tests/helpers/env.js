/**
 * Defaults so unit tests that import `createApp` / `config` do not require a
 * local .env. Real secrets still win if they are already in the environment.
 */
process.env.NODE_ENV ||= 'test';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-that-is-long-enough-xx';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-that-is-different-xx';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/hms_test';
process.env.JOBS_ENABLED ||= 'false';
