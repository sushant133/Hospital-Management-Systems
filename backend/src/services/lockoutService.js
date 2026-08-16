/**
 * Account lockout after repeated failed passwords.
 *
 * Pure functions so the policy can be tested without Mongo. The controller
 * persists the result on the User document.
 *
 * Unknown emails are *not* locked here — that would be a write amplification
 * oracle. The IP rate limit on POST /auth/login is the stuffing backstop.
 */

export function isLocked(user, now = new Date()) {
  if (!user?.lockedUntil) return false;
  return new Date(user.lockedUntil).getTime() > now.getTime();
}

/**
 * Apply one failed password attempt.
 *
 * @returns {{ failedLoginCount: number, lockedUntil: Date|null, justLocked: boolean }}
 */
export function registerFailedLogin(
  user,
  { maxAttempts = 5, lockMinutes = 15, now = new Date() } = {},
) {
  const failedLoginCount = (user.failedLoginCount ?? 0) + 1;
  const justLocked = failedLoginCount >= maxAttempts;
  const lockedUntil = justLocked ? new Date(now.getTime() + lockMinutes * 60 * 1000) : user.lockedUntil ?? null;
  return { failedLoginCount, lockedUntil, justLocked };
}

/** Clear the counter after a successful password. */
export function registerSuccessfulLogin() {
  return { failedLoginCount: 0, lockedUntil: null };
}

export default { isLocked, registerFailedLogin, registerSuccessfulLogin };
