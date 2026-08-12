import { z } from 'zod';
import { AUDIT_ACTIONS, AUDIT_OUTCOMES } from '../../models/AuditLog.js';
import { extendListQuery, optionalObjectId, optionalDate } from '../../utils/commonSchemas.js';

export const listAuditLogsQuery = extendListQuery({
  userId: optionalObjectId,
  patientId: optionalObjectId,
  resourceId: optionalObjectId,
  resourceType: z.string().trim().max(80).optional(),
  module: z.string().trim().max(80).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  outcome: z.enum(AUDIT_OUTCOMES).optional(),
  /** Inclusive lower bound on createdAt. */
  from: optionalDate,
  /** Exclusive upper bound on createdAt. */
  to: optionalDate,
});
