import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Roles and the permission matrix live in their own modules so they can be
 * imported without triggering environment validation. Re-exported here because
 * most of the codebase reaches for `config/env.js` first.
 */
export { ROLES, ROLE_VALUES, ROLE_LABELS } from './roles.js';
export { MODULES, PERMISSION_MATRIX, can, permissionsForRole } from './permissions.js';

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy backend/.env.example to backend/.env and fill it in.`,
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
  port: Number(optional('PORT', 5050)),

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
    portalAccessName: 'hms_portal_access',
    portalRefreshName: 'hms_portal_refresh',
    // Keep in sync with jwt expiries — these drive the browser cookie lifetime.
    accessMaxAgeMs: 15 * 60 * 1000,
    refreshMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  }),

  clientOrigins: optional('CLIENT_ORIGIN', 'http://localhost:5180,http://127.0.0.1:5180')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  bcryptRounds: 12,

  /**
   * Login abuse controls. Lockout is per *account* (failed password against a
   * real user). The IP rate limit is the backstop for stuffing unknown emails.
   */
  auth: Object.freeze({
    maxFailedLogins: Number(optional('LOGIN_MAX_ATTEMPTS', 5)),
    lockMinutes: Number(optional('LOGIN_LOCK_MINUTES', 15)),
    rateLimitWindowMs: Number(optional('LOGIN_RATE_WINDOW_MS', 15 * 60 * 1000)),
    rateLimitMax: Number(optional('LOGIN_RATE_MAX', 20)),
  }),

  /**
   * Off by default: a `view` row per chart open would drown the write trail.
   * Turn on for investigations or a regulator who asked for read-access logs.
   */
  auditReads: optional('AUDIT_READS', 'false') === 'true',

  /** Optional HTTP endpoint a hospital points at Slack / a pager. */
  notifyWebhookUrl: optional('NOTIFY_WEBHOOK_URL', '') || '',

  /**
   * A11 — SMS. The channel that actually reaches a Nepali patient.
   * `provider` selects an adapter in services/smsService.js.
   */
  sms: Object.freeze({
    enabled: optional('SMS_ENABLED', 'false') === 'true',
    provider: optional('SMS_PROVIDER', 'sparrow'), // sparrow | aakash | webhook
    baseUrl: optional('SMS_BASE_URL', 'https://api.sparrowsms.com/v2/sms/'),
    token: optional('SMS_TOKEN', ''),
    senderId: optional('SMS_SENDER_ID', 'Demo'),
    /** Rupees per segment, for the spend report. Ask your provider. */
    costPerSegment: Number(optional('SMS_COST_PER_SEGMENT', 1)),
    maxAttempts: Number(optional('SMS_MAX_ATTEMPTS', 3)),
  }),

  /**
   * A8 — IRD. Nepali tax and billing compliance.
   *
   * `vatPercent` applies only to charge lines classified `taxable`; most
   * hospital services are exempt and take no VAT at all. See
   * models/Invoice.js TAX_CATEGORIES, and confirm the classification of your
   * own service catalogue with your auditor.
   */
  ird: Object.freeze({
    vatPercent: Number(optional('IRD_VAT_PERCENT', 13)),
    /** The hospital's own registration, printed on every bill. */
    pan: optional('HOSPITAL_PAN', ''),
    vatRegistered: optional('HOSPITAL_VAT_REGISTERED', 'false') === 'true',
    /** CBMS real-time invoice sync. Off until the hospital is registered. */
    cbmsEnabled: optional('CBMS_ENABLED', 'false') === 'true',
    cbmsUrl: optional('CBMS_URL', ''),
    cbmsUsername: optional('CBMS_USERNAME', ''),
    cbmsPassword: optional('CBMS_PASSWORD', ''),
    cbmsSellerPan: optional('CBMS_SELLER_PAN', ''),
    cbmsMaxAttempts: Number(optional('CBMS_MAX_ATTEMPTS', 10)),
  }),

  /** A10 — domestic payment gateways. Credentials per provider. */
  gateways: Object.freeze({
    esewa: Object.freeze({
      enabled: optional('ESEWA_ENABLED', 'false') === 'true',
      merchantCode: optional('ESEWA_MERCHANT_CODE', ''),
      secret: optional('ESEWA_SECRET', ''),
      baseUrl: optional('ESEWA_BASE_URL', 'https://rc-epay.esewa.com.np'),
    }),
    khalti: Object.freeze({
      enabled: optional('KHALTI_ENABLED', 'false') === 'true',
      secretKey: optional('KHALTI_SECRET_KEY', ''),
      baseUrl: optional('KHALTI_BASE_URL', 'https://a.khalti.com/api/v2'),
    }),
    fonepay: Object.freeze({
      enabled: optional('FONEPAY_ENABLED', 'false') === 'true',
      merchantCode: optional('FONEPAY_MERCHANT_CODE', ''),
      secret: optional('FONEPAY_SECRET', ''),
      baseUrl: optional('FONEPAY_BASE_URL', ''),
    }),
    connectips: Object.freeze({
      enabled: optional('CONNECTIPS_ENABLED', 'false') === 'true',
      merchantId: optional('CONNECTIPS_MERCHANT_ID', ''),
      appId: optional('CONNECTIPS_APP_ID', ''),
      appName: optional('CONNECTIPS_APP_NAME', ''),
      password: optional('CONNECTIPS_PASSWORD', ''),
      baseUrl: optional('CONNECTIPS_BASE_URL', ''),
    }),
    /** Where the gateway sends the customer back to after paying. */
    returnUrl: optional('GATEWAY_RETURN_URL', 'http://localhost:5180/billing/payment-result'),
  }),

  /** A9 — statutory reporting to MoHP's DHIS2 instance. */
  hmis: Object.freeze({
    enabled: optional('HMIS_ENABLED', 'false') === 'true',
    dhis2Url: optional('DHIS2_URL', ''),
    dhis2Username: optional('DHIS2_USERNAME', ''),
    dhis2Password: optional('DHIS2_PASSWORD', ''),
    /** This facility's code in the national Health Facility Registry. */
    facilityCode: optional('HMIS_FACILITY_CODE', ''),
    /** The DHIS2 organisation unit id this facility reports as. */
    orgUnitId: optional('DHIS2_ORG_UNIT_ID', ''),
  }),

  /**
   * Default locale for staff-facing UI and patient documents.
   * Nepali by default — this is a Nepali hospital.
   */
  defaultLocale: optional('DEFAULT_LOCALE', 'en'),

  /** Local hour (0–23) the in-process job runner fires. */
  jobs: Object.freeze({
    enabled: optional('JOBS_ENABLED', 'true') === 'true',
    hour: Number(optional('JOBS_HOUR', 2)),
  }),

  /**
   * Generated patient documents (lab reports, and later radiology reports and
   * invoices). NOT served by express.static — these are patient records and go
   * out only through authenticated download routes.
   */
  uploadsDir: path.resolve(serverRoot, optional('UPLOADS_DIR', 'uploads')),

  /** Printed on report letterheads and on every bill. */
  hospital: Object.freeze({
    name: optional('HOSPITAL_NAME', 'General Hospital'),
    /** The Nepali name — what goes on the top line of a Nepali document. */
    nameNe: optional('HOSPITAL_NAME_NE', ''),
    address: optional('HOSPITAL_ADDRESS', '1 Hospital Road, City'),
    addressNe: optional('HOSPITAL_ADDRESS_NE', ''),
    phone: optional('HOSPITAL_PHONE', ''),
    email: optional('HOSPITAL_EMAIL', ''),
    /** District code, for the HMIS return header. */
    districtCode: optional('HOSPITAL_DISTRICT_CODE', ''),
    /** Tier, which sets Aama Surakshya package rates and referral position. */
    level: optional('HOSPITAL_LEVEL', 'district'), // primary | district | provincial | central
  }),

  seed: Object.freeze({
    adminEmail: optional('SEED_ADMIN_EMAIL', 'admin@hospital.local'),
    adminPassword: optional('SEED_ADMIN_PASSWORD', 'Admin@12345'),
    adminFirstName: optional('SEED_ADMIN_FIRST_NAME', 'System'),
    adminLastName: optional('SEED_ADMIN_LAST_NAME', 'Administrator'),
  }),
});

export default config;
