import { ZodError } from 'zod';
import ApiError from '../utils/ApiError.js';

/**
 * Validate request parts against zod schemas.
 *
 *   validate({ body: createPatientSchema, params: idParamSchema })
 *
 * The PARSED result replaces req.body / req.params / req.query, so controllers
 * receive coerced, stripped data. Unknown keys are dropped by zod objects,
 * which is what prevents mass assignment (a client cannot smuggle in
 * `createdBy` or `isActive`).
 */
export function validate(schemas = {}) {
  return function validateRequest(req, _res, next) {
    try {
      for (const part of ['body', 'params', 'query']) {
        const schema = schemas[part];
        if (!schema) continue;

        const parsed = schema.parse(req[part]);

        if (part === 'query') {
          // Express 5 exposes req.query via a getter — assigning to it throws.
          // Stash the validated value where controllers read it from.
          req.validatedQuery = parsed;
        } else {
          req[part] = parsed;
        }
      }
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        return next(ApiError.validation('Validation failed', formatZodIssues(error)));
      }
      return next(error);
    }
  };
}

/** Flatten zod issues into a client-friendly [{ field, message }] list. */
export function formatZodIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));
}

/** Controllers read query params through this so validation is never bypassed. */
export function getQuery(req) {
  return req.validatedQuery ?? req.query ?? {};
}

export default validate;
