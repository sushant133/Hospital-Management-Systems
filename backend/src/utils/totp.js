import crypto from 'node:crypto';

/**
 * ============================================================================
 * TOTP (RFC 6238)
 * ============================================================================
 *
 * Implemented on Node's crypto rather than pulled from npm. TOTP is about forty
 * lines of HMAC and base32; adding a dependency to a hospital system's auth path
 * — one more package with its own supply chain — is the larger risk of the two.
 *
 * Compatible with Google Authenticator, Authy and FreeOTP.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, which is what authenticator apps expect. */
export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input) {
  const cleaned = String(input).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new shared secret. 20 bytes is the RFC's recommendation for SHA-1. */
export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** The code for one time step. */
export function generateCode(secret, { time = Date.now(), step = 30, digits = 6 } = {}) {
  const counter = Math.floor(time / 1000 / step);

  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();

  // Dynamic truncation, per the RFC.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Verify a code, allowing for clock drift.
 *
 * A `window` of 1 accepts the previous and next step — about ninety seconds
 * total. Phone clocks drift and people type slowly; a zero window produces a
 * stream of support calls and teaches users to disable MFA.
 *
 * The comparison is constant-time: a timing side channel on a six-digit code is
 * a real attack when an attacker can retry.
 */
export function verifyCode(secret, code, { time = Date.now(), step = 30, digits = 6, window = 1 } = {}) {
  if (!secret || !code) return false;

  const candidate = String(code).replace(/\s/g, '');
  if (candidate.length !== digits) return false;

  for (let drift = -window; drift <= window; drift += 1) {
    const expected = generateCode(secret, { time: time + drift * step * 1000, step, digits });
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** The `otpauth://` URI an authenticator app scans as a QR code. */
export function otpauthUrl({ secret, account, issuer = 'HMS' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params}`;
}

/**
 * Single-use recovery codes.
 *
 * A phone gets lost, broken or stolen, and a clinician locked out of the system
 * at 2am is a patient-safety problem, not an inconvenience. Stored hashed — the
 * database must not hold a usable bypass for every account.
 */
export function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString('hex').match(/.{1,5}/g).join('-'),
  );
}

export const hashRecoveryCode = (code) =>
  crypto.createHash('sha256').update(String(code).replace(/[\s-]/g, '').toLowerCase()).digest('hex');

export default { generateSecret, generateCode, verifyCode, otpauthUrl, generateRecoveryCodes, hashRecoveryCode };
