import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

export const NOTE_TYPES = ['soap', 'progress', 'nursing', 'discharge'];

/**
 * The SOAP fields. A `soap` note must carry at least one of these; the other
 * note types use `content` instead — a discharge summary or a nursing entry is
 * prose, and forcing it into four boxes helps nobody.
 */
export const SOAP_FIELDS = ['subjective', 'objective', 'assessment', 'plan'];

/**
 * Append-only clinical notes.
 *
 * A note is never edited and never deleted. A correction creates a NEW document
 * linked to the one it replaces:
 *
 *   v1 { _id: A, version: 1, supersededBy: B }
 *   v2 { _id: B, version: 2, supersedes: A, amendmentReason: 'Corrected dose' }
 *
 * Both stay readable. This is enforced here, at the model layer, not by
 * convention in the controller — see the guards at the bottom of the file. The
 * permission matrix reinforces it by simply not defining `edit` or `delete` for
 * this module, so no route can be wired to one.
 */
const clinicalNoteSchema = new Schema(
  {
    // Patient and encounter are both required.
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'A note must reference a patient'],
      index: true,
    },
    encounterId: {
      type: Schema.Types.ObjectId,
      ref: 'Encounter',
      required: [true, 'A note must reference an encounter'],
      index: true,
    },

    authorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'A note must record its author'],
      index: true,
    },
    /** Snapshotted so the chart stays readable if the account is later changed. */
    authorName: { type: String, trim: true },
    authorRole: { type: String, trim: true },

    noteType: { type: String, enum: NOTE_TYPES, default: 'soap', required: true, index: true },

    subjective: { type: String, trim: true, default: '' },
    objective: { type: String, trim: true, default: '' },
    assessment: { type: String, trim: true, default: '' },
    plan: { type: String, trim: true, default: '' },
    /** Free text for progress / nursing / discharge notes. */
    content: { type: String, trim: true, default: '' },

    /**
     * When the author committed the note. Set at creation — there is no draft
     * state, because a note that can be revised in place is not append-only.
     */
    signedAt: { type: Date, default: () => new Date() },

    // --- Amendment chain ---
    version: { type: Number, default: 1, min: 1 },
    supersedes: { type: Schema.Types.ObjectId, ref: 'ClinicalNote', default: null },
    supersededBy: { type: Schema.Types.ObjectId, ref: 'ClinicalNote', default: null, index: true },
    amendmentReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'clinicalNotes',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

clinicalNoteSchema.plugin(auditable);

// The chart: a patient's notes newest-first, and a visit's notes in order.
clinicalNoteSchema.index({ patientId: 1, signedAt: -1 });
clinicalNoteSchema.index({ encounterId: 1, signedAt: 1 });
clinicalNoteSchema.index({ noteType: 1, signedAt: -1 });

/** The head of a chain — the version the chart should show. */
clinicalNoteSchema.virtual('isCurrent').get(function isCurrent() {
  return this.supersededBy === null || this.supersededBy === undefined;
});

clinicalNoteSchema.pre('validate', function requireBody(next) {
  const hasSoap = SOAP_FIELDS.some((field) => (this[field] ?? '').trim().length > 0);
  const hasContent = (this.content ?? '').trim().length > 0;

  if (this.noteType === 'soap' && !hasSoap) {
    return next(new Error('A SOAP note needs at least one of subjective, objective, assessment or plan'));
  }
  if (this.noteType !== 'soap' && !hasContent && !hasSoap) {
    return next(new Error('A note cannot be empty'));
  }
  return next();
});

// ---------------------------------------------------------------- guards ----

/**
 * The ONLY mutation permitted on an existing note is linking it to the note
 * that supersedes it — that link is how the chain is formed, and it is written
 * once, by the amend flow.
 */
const LINK_FIELDS = new Set(['supersededBy', 'updatedBy', 'updatedAt']);

function rejectMutation(next) {
  next(
    new Error(
      'Clinical notes are append-only. Amend the note instead — that creates a new ' +
        'version linked to this one, and both stay readable.',
    ),
  );
}

clinicalNoteSchema.pre('updateOne', rejectMutation);
clinicalNoteSchema.pre('updateMany', rejectMutation);
clinicalNoteSchema.pre('findOneAndUpdate', rejectMutation);
clinicalNoteSchema.pre('deleteOne', rejectMutation);
clinicalNoteSchema.pre('deleteMany', rejectMutation);
clinicalNoteSchema.pre('findOneAndDelete', rejectMutation);

clinicalNoteSchema.pre('save', function guardResave(next) {
  if (this.isNew) return next();

  const touched = this.modifiedPaths().filter((path) => !LINK_FIELDS.has(path));
  if (touched.length > 0) {
    return next(
      new Error(
        `Clinical notes are append-only; cannot modify: ${touched.join(', ')}. ` +
          'Amend the note instead.',
      ),
    );
  }
  return next();
});

export const ClinicalNote = mongoose.model('ClinicalNote', clinicalNoteSchema);
export default ClinicalNote;
