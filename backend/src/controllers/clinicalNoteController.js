import { ClinicalNote, Encounter, Patient } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import sendResponse, { sendCreated } from '../utils/sendResponse.js';
import { getQuery } from '../middleware/validateRequest.js';
import { buildPagination, buildMeta, activeScope, andFilters } from '../utils/queryHelpers.js';

const POPULATE = [
  { path: 'authorId', select: 'firstName lastName role specialization' },
  { path: 'encounterId', select: 'encounterNumber type status startedAt' },
];

/**
 * Clinical notes. There is no update or delete handler — notes are append-only.
 */

/** GET /clinical-notes */
export const listNotes = asyncHandler(async (req, res) => {
  const query = getQuery(req);
  const { page, limit, skip, sort } = buildPagination({ ...query, sort: query.sort || '-signedAt' });

  const dateRange = {};
  if (query.from) dateRange.$gte = query.from;
  if (query.to) dateRange.$lte = query.to;

  const filter = andFilters(
    activeScope(query, req.user),
    query.patientId ? { patientId: query.patientId } : null,
    query.encounterId ? { encounterId: query.encounterId } : null,
    query.authorId ? { authorId: query.authorId } : null,
    query.noteType ? { noteType: query.noteType } : null,
    // The chart shows current versions; superseded ones are reached through
    // the history endpoint, so they don't clutter the list twice.
    query.includeSuperseded ? null : { supersededBy: null },
    Object.keys(dateRange).length ? { signedAt: dateRange } : null,
  );

  const [notes, total] = await Promise.all([
    ClinicalNote.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    ClinicalNote.countDocuments(filter),
  ]);

  return sendResponse(res, { data: notes, meta: buildMeta({ page, limit, total }) });
});

/** GET /clinical-notes/:id */
export const getNote = asyncHandler(async (req, res) => {
  const note = await ClinicalNote.findById(req.params.id).populate(POPULATE).lean();
  if (!note) throw ApiError.notFound('Note not found');
  return sendResponse(res, { data: note });
});

/**
 * GET /clinical-notes/:id/history — the full amendment chain, oldest first.
 *
 * Walks to the root of the chain and back down, so the caller gets every
 * version regardless of which one they happened to ask for.
 */
export const getNoteHistory = asyncHandler(async (req, res) => {
  const note = await ClinicalNote.findById(req.params.id).lean();
  if (!note) throw ApiError.notFound('Note not found');

  // Walk back to the original.
  let root = note;
  const guard = new Set([String(note._id)]);
  while (root.supersedes) {
    const previous = await ClinicalNote.findById(root.supersedes).lean();
    if (!previous || guard.has(String(previous._id))) break;
    guard.add(String(previous._id));
    root = previous;
  }

  // Then forward, collecting every version.
  const chain = [root];
  let cursor = root;
  while (cursor.supersededBy) {
    const next = await ClinicalNote.findById(cursor.supersededBy)
      .populate(POPULATE)
      .lean();
    if (!next || guard.has(`fwd:${next._id}`)) break;
    guard.add(`fwd:${next._id}`);
    chain.push(next);
    cursor = next;
  }

  return sendResponse(res, {
    data: chain,
    meta: { versions: chain.length, currentId: chain[chain.length - 1]?._id },
  });
});

/** POST /clinical-notes */
export const createNote = asyncHandler(async (req, res) => {
  const { patientId, encounterId, ...rest } = req.body;

  const encounter = await assertOpenEncounterForPatient(encounterId, patientId);

  const note = await ClinicalNote.create({
    ...rest,
    patientId: encounter.patientId,
    encounterId: encounter._id,
    authorId: req.user._id,
    authorName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
    authorRole: req.user.role,
    signedAt: new Date(),
    version: 1,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await note.populate(POPULATE);
  return sendCreated(res, { message: 'Note signed', data: note });
});

/**
 * POST /clinical-notes/:id/amend
 *
 * Writes a NEW version and links the two. The original is never touched beyond
 * its `supersededBy` pointer — the one mutation the model permits.
 */
export const amendNote = asyncHandler(async (req, res) => {
  const original = await ClinicalNote.findById(req.params.id);
  if (!original) throw ApiError.notFound('Note not found');

  if (original.supersededBy) {
    throw ApiError.conflict(
      'This version has already been amended. Amend the current version instead.',
      { code: 'NOTE_ALREADY_AMENDED', details: { currentId: original.supersededBy } },
    );
  }

  const { amendmentReason, ...fields } = req.body;

  const amended = await ClinicalNote.create({
    // Carry everything forward, then apply the corrections, so an amendment
    // that fixes one field does not silently blank the others.
    patientId: original.patientId,
    encounterId: original.encounterId,
    noteType: original.noteType,
    subjective: fields.subjective ?? original.subjective,
    objective: fields.objective ?? original.objective,
    assessment: fields.assessment ?? original.assessment,
    plan: fields.plan ?? original.plan,
    content: fields.content ?? original.content,

    authorId: req.user._id,
    authorName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
    authorRole: req.user.role,
    signedAt: new Date(),

    version: original.version + 1,
    supersedes: original._id,
    amendmentReason,

    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  original.supersededBy = amended._id;
  original.updatedBy = req.user._id;
  await original.save(); // permitted: only the supersede link changed

  await amended.populate(POPULATE);
  return sendCreated(res, {
    message: `Amended — version ${amended.version}. The previous version remains on the record.`,
    data: amended,
  });
});

/**
 * A note attaches to a visit, and a visit that is closed should not grow new
 * notes — a late entry is an amendment to the record, not a fresh one.
 */
async function assertOpenEncounterForPatient(encounterId, patientId) {
  const encounter = await Encounter.findOne({ _id: encounterId, isActive: true });
  if (!encounter) {
    throw ApiError.badRequest('The selected visit does not exist', {
      details: [{ field: 'encounterId', message: 'Invalid visit' }],
    });
  }

  if (patientId && String(encounter.patientId) !== String(patientId)) {
    throw ApiError.badRequest('That visit belongs to a different patient', {
      details: [{ field: 'encounterId', message: 'Visit and patient do not match' }],
    });
  }

  if (['discharged', 'cancelled'].includes(encounter.status)) {
    throw ApiError.conflict(
      `This visit is ${encounter.status} — notes can no longer be added to it.`,
      { code: 'ENCOUNTER_CLOSED' },
    );
  }

  const patient = await Patient.exists({ _id: encounter.patientId, isActive: true });
  if (!patient) {
    throw ApiError.badRequest('That patient record is inactive');
  }

  return encounter;
}
