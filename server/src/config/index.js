import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Roles and the permission matrix live in their own modules so they can be
 * imported without triggering environment validation. Re-exported here because
 * most of the codebase reaches for `config/index.js` first.
 */
export { ROLES, ROLE_VALUES, ROLE_LABELS } from './roles.js';
export { MODULES, PERMISSION_MATRIX, can, permissionsForRole } from './permissions.js';

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy server/.env.example to server/.env and fill it in.`,
    );
  }
  return value.trim();
}

function optional(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

const nodeEnv = optional('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';

const accessSecret = required('JWT_ACCESS_SECRET');
const refreshSecret = required('JWT_REFRESH_SECRET');

if (accessSecret === refreshSecret) {
  throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.');
}
if (isProduction && (accessSecret.length < 32 || refreshSecret.length < 32)) {
  throw new Error('JWT secrets must be at least 32 characters in production.');
}

export const config = Object.freeze({
  env: nodeEnv,
  isProduction,
  port: Number(optional('PORT', 5000)),

  mongoUri: required('MONGODB_URI'),

  jwt: Object.freeze({
    accessSecret,
    refreshSecret,
    accessExpiresIn: optional('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: optional('JWT_REFRESH_EXPIRES_IN', '7d'),
  }),

  cookie: Object.freeze({
    domain: optional('COOKIE_DOMAIN', '') || undefined,
    secure: optional('COOKIE_SECURE', 'false') === 'true' || isProduction,
    accessName: 'hms_access_token',
    refreshName: 'hms_refresh_token',
    // Keep in sync with jwt expiries — these drive the browser cookie lifetime.
    accessMaxAgeMs: 15 * 60 * 1000,
    refreshMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  }),

  clientOrigins: optional('CLIENT_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  bcryptRounds: 12,

  /**
   * Generated patient documents (lab reports, and later radiology reports and
   * invoices). NOT served by express.static — these are patient records and go
   * out only through authenticated download routes.
   */
  uploadsDir: path.resolve(serverRoot, optional('UPLOADS_DIR', 'uploads')),

  /** Printed on report letterheads. */
  hospital: Object.freeze({
    name: optional('HOSPITAL_NAME', 'General Hospital'),
    address: optional('HOSPITAL_ADDRESS', '1 Hospital Road, City'),
    phone: optional('HOSPITAL_PHONE', ''),
    email: optional('HOSPITAL_EMAIL', ''),
  }),

  seed: Object.freeze({
    adminEmail: optional('SEED_ADMIN_EMAIL', 'admin@hospital.local'),
    adminPassword: optional('SEED_ADMIN_PASSWORD', 'Admin@12345'),
    adminFirstName: optional('SEED_ADMIN_FIRST_NAME', 'System'),
    adminLastName: optional('SEED_ADMIN_LAST_NAME', 'Administrator'),
  }),
});

export default config;
