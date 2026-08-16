import { z } from 'zod';
import { SHIFTS } from '../models/Attendance.js';
import { ROSTER_STATUSES } from '../models/ShiftRoster.js';
import {
  objectId,
  optionalObjectId,
  optionalString,
  optionalDate,
  extendListQuery,
} from '../utils/commonSchemas.js';

export const listRostersQuery = extendListQuery({
  departmentId: optionalObjectId,
  status: z.enum(ROSTER_STATUSES).optional(),
  weekStart: optionalDate,
  from: optionalDate,
  to: optionalDate,
});

export const ownRosterQuery = z.object({
  from: optionalDate,
  to: optionalDate,
});

export const createRosterSchema = z.object({
  /** Any date in the week — the server snaps it to Monday. */
  weekStart: z.coerce.date({ invalid_type_error: 'A week is required' }),
  departmentId: optionalObjectId,
  notes: optionalString(1000),
});

const assignmentItem = z.object({
  userId: objectId,
  date: z.coerce.date({ invalid_type_error: 'A date is required' }),
  shift: z.enum(SHIFTS),
  notes: optionalString(300),
});

export const replaceAssignmentsSchema = z.object({
  assignments: z.array(assignmentItem).max(500),
});

export const createAssignmentSchema = assignmentItem;

export const updateAssignmentSchema = z
  .object({
    shift: z.enum(SHIFTS).optional(),
    notes: optionalString(300),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide a shift or a note to update',
  });
