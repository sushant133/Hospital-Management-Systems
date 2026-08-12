import ApiError from '../utils/ApiError.js';
import { can, assertPermissionExists, MODULES } from '../config/permissions.js';

/**
 * The only authorization gate in the system.
 *
 *   router.post(
 *     '/',
 *     requireAuth,
 *     requirePermission(MODULES.PATIENTS, 'create'),
 *     controller.createPatient,
 *   );
 *
 * Who is allowed is decided entirely by the matrix in config/permissions.js.
 * Routes name a capability; they never name a role. That means a permission
 * change is a one-file edit and the matrix can be read as the authoritative
 * answer to "who can do X?" without grepping the routing layer.
 *
 * Must be mounted after `requireAuth`.
 */
export function requirePermission(module, action) {
  // Fail at route-definition time (i.e. server boot) rather than on the first
  // request that hits the typo.
  assertPermissionExists(module, action);

  return function permissionGuard(req, _res, next) {
    if (!req.user) {
      return next(
        ApiError.unauthorized('Authentication required', { code: 'NO_USER_ON_REQUEST' }),
      );
    }

    if (!can(req.user.role, module, action)) {
      return next(
        ApiError.forbidden(`Your role is not permitted to ${action} ${module}.`, {
          code: 'INSUFFICIENT_PERMISSION',
          details: { module, action, role: req.user.role },
        }),
      );
    }

    // Recorded so the audit middleware can log which capability authorized the
    // write, not just which route was hit.
    req.permission = { module, action };
    return next();
  };
}

/**
 * Guard for routes where the answer depends on the record, not just the role —
 * "view any payslip" versus "view my own payslip".
 *
 * Passes when the user holds `module.action`, OR when `isOwner(req)` returns
 * true and the role holds the fallback own-record action.
 *
 *   requirePermissionOrOwn(MODULES.PAYROLL, 'view', 'viewOwn',
 *     (req) => req.params.userId === String(req.user._id))
 */
export function requirePermissionOrOwn(module, action, ownAction, isOwner) {
  assertPermissionExists(module, action);
  assertPermissionExists(module, ownAction);

  if (typeof isOwner !== 'function') {
    throw new Error('requirePermissionOrOwn() needs an isOwner(req) predicate.');
  }

  return function ownershipGuard(req, _res, next) {
    if (!req.user) {
      return next(
        ApiError.unauthorized('Authentication required', { code: 'NO_USER_ON_REQUEST' }),
      );
    }

    if (can(req.user.role, module, action)) {
      req.permission = { module, action };
      return next();
    }

    if (isOwner(req) && can(req.user.role, module, ownAction)) {
      req.permission = { module, action: ownAction };
      return next();
    }

    return next(
      ApiError.forbidden(`Your role is not permitted to ${action} ${module}.`, {
        code: 'INSUFFICIENT_PERMISSION',
        details: { module, action, role: req.user.role },
      }),
    );
  };
}

export { MODULES };
export default requirePermission;
