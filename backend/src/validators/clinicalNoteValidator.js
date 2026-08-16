import { z } from 'zod';
import {
  objectId,
  optionalObjectId,
  optionalString,
  optionalDate,
  extendListQuery,
} from '../utils/commonSchemas.js';
import { NOTE_TYPES } from '../models/index.js';

const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((v) => v === true || v === 'true');

const noteBody = {
  subjective: optionalString(4000),
  objective: optionalString(4000),
  assessment: optionalString(4000),
  plan: optionalString(4000),
  content: optionalString(8000),
};

export const listNotesQuery = extendListQuery({
  patientId: optionalObjectId,
  encounterId: optionalObjectId,
  authorId: optionalObjectId,
  noteType: z.enum(NOTE_TYPES).optional(),
  from: optionalDate,
  to: optionalDate,
  /** Off by default — the chart shows current versions, not every revision. */
  includeSuperseded: booleanFlag,
});

export const createNoteSchema = z
  .object({
    patientId: optionalObjectId,
    encounterId: objectId,
    noteType: z.enum(NOTE_TYPES).default('soap'),
    ...noteBody,
  })
  .refine(
    (v) =>
      v.noteType !== 'soap' ||
      [v.subjective, v.objective, v.assessment, v.plan].some((f) => (f ?? '').trim().length > 0),
    {
      message: 'A SOAP note needs at least one of subjective, objective, assessment or plan',
      path: ['subjective'],
    },
  )
  .refine(
    (v) =>
      v.noteType === 'soap' ||
      (v.content ?? '').trim().length > 0 ||
      [v.subjective, v.objective, v.assessment, v.plan].some((f) => (f ?? '').trim().length > 0),
    { message: 'A note cannot be empty', path: ['content'] },
  );

/**
 * An amendment carries only the fields being corrected — the controller copies
 * the rest forward from the version being replaced. The reason is mandatory:
 * an amended clinical record without a stated reason is worse than no
 * amendment at all.
 */
export const amendNoteSchema = z
  .object({
    amendmentReason: z
      .string()
      .trim()
      .min(10, 'Give a reason of at least 10 characters')
      .max(500, 'Reason must be 500 characters or fewer'),
    ...noteBody,
  })
  .refine(
    (v) =>
      [v.subjective, v.objective, v.assessment, v.plan, v.content].some(
        (f) => f !== undefined && f !== null,
      ),
    { message: 'An amendment must change at least one field', path: ['amendmentReason'] },
  );
