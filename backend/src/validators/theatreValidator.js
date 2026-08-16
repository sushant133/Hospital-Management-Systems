import { z } from 'zod';
import {
  objectId,
  optionalObjectId,
  optionalString,
  nonEmptyString,
  dateField,
  extendListQuery,
} from '../utils/commonSchemas.js';
import { SURGERY_STATUSES, THEATRE_ROOMS } from '../models/Surgery.js';

const checklistTick = z
  .object({
    checked: z.boolean().optional(),
    checkedAt: z.coerce.date().optional().nullable(),
    checkedBy: optionalObjectId,
  })
  .optional();

export const listSurgeriesQuery = extendListQuery({
  status: z.enum(SURGERY_STATUSES).optional(),
  theatre: z.enum(THEATRE_ROOMS).optional(),
  surgeonId: optionalObjectId,
  patientId: optionalObjectId,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const implantSchema = z.object({
  name: nonEmptyString(160, 'Implant name'),
  catalogueNo: optionalString(80),
  lotNo: optionalString(80),
  site: optionalString(80),
});

export const createSurgerySchema = z
  .object({
    patientId: objectId,
    encounterId: objectId,
    theatre: z.enum(THEATRE_ROOMS, { errorMap: () => ({ message: 'Choose a theatre' }) }),
    procedure: nonEmptyString(200, 'Procedure'),
    diagnosis: optionalString(400),
    laterality: z.enum(['left', 'right', 'bilateral', 'n/a']).optional().default('n/a'),
    priority: z.enum(['elective', 'urgent', 'emergency']).optional().default('elective'),
    scheduledStart: dateField,
    scheduledEnd: dateField,
    surgeonId: objectId,
    anaesthetistId: optionalObjectId,
    assistants: z.array(objectId).max(8).optional().default([]),
    notes: optionalString(2000),
    price: z.coerce.number().min(0).optional().default(0),
  })
  .refine((data) => data.scheduledEnd > data.scheduledStart, {
    message: 'End time must be after start time',
    path: ['scheduledEnd'],
  });

export const updateSurgerySchema = z
  .object({
    procedure: optionalString(200),
    diagnosis: optionalString(400),
    laterality: z.enum(['left', 'right', 'bilateral', 'n/a']).optional(),
    priority: z.enum(['elective', 'urgent', 'emergency']).optional(),
    scheduledStart: dateField.optional(),
    scheduledEnd: dateField.optional(),
    surgeonId: objectId.optional(),
    anaesthetistId: optionalObjectId,
    assistants: z.array(objectId).max(8).optional(),
    notes: optionalString(2000),
    findings: optionalString(4000),
    whoChecklist: z
      .object({
        signIn: z
          .object({
            identityConfirmed: checklistTick,
            siteMarked: checklistTick,
            consentConfirmed: checklistTick,
            allergiesReviewed: checklistTick,
            pulseOximeterOn: checklistTick,
          })
          .optional(),
        timeOut: z
          .object({
            teamIntroduced: checklistTick,
            procedureConfirmed: checklistTick,
            antibioticGiven: checklistTick,
            imagingDisplayed: checklistTick,
          })
          .optional(),
        signOut: z
          .object({
            procedureRecorded: checklistTick,
            countsCorrect: checklistTick,
            specimensLabelled: checklistTick,
            equipmentProblemsNoted: checklistTick,
          })
          .optional(),
      })
      .optional(),
    anaesthesia: z
      .object({
        type: z.enum(['ga', 'spinal', 'epidural', 'regional', 'local', 'sedation', '']).optional(),
        asaClass: z.enum(['I', 'II', 'III', 'IV', 'V', '']).optional(),
        inductionAt: z.coerce.date().optional().nullable(),
        reversalAt: z.coerce.date().optional().nullable(),
        notes: optionalString(2000),
      })
      .optional(),
    implants: z.array(implantSchema).max(40).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nothing to update' });

export const completeSurgerySchema = z.object({
  findings: optionalString(4000),
});

export const cancelSurgerySchema = z.object({
  reason: z.string().trim().min(5, 'Give a cancellation reason').max(1000),
});
