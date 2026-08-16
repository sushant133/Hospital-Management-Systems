import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const { Schema } = mongoose;

const instanceSchema = new Schema(
  {
    sopInstanceUid: { type: String, required: true, trim: true },
    seriesInstanceUid: { type: String, trim: true, default: '' },
    instanceNumber: { type: Number, default: null },
    path: { type: String, required: true, trim: true },
    filename: { type: String, required: true, trim: true },
    sizeBytes: { type: Number, required: true, min: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

/**
 * One imaging study (DICOM Study Instance UID).
 *
 * This is a hospital-side store, not a full PACS: no C-STORE SCP, no hanging
 * protocols. Modalities (or a bridge) POST files; clinicians retrieve them
 * through authenticated routes the same way they retrieve lab PDFs.
 */
const dicomStudySchema = new Schema(
  {
    studyInstanceUid: { type: String, required: true, unique: true, trim: true, index: true },
    accessionNumber: { type: String, trim: true, default: '', index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null, index: true },
    radiologyOrderId: { type: Schema.Types.ObjectId, ref: 'RadiologyOrder', default: null, index: true },
    patientName: { type: String, trim: true, default: '' },
    patientMrnHint: { type: String, trim: true, default: '' },
    modality: { type: String, trim: true, default: '', index: true },
    studyDate: { type: String, trim: true, default: '' },
    studyDescription: { type: String, trim: true, default: '' },
    instances: { type: [instanceSchema], default: [] },
  },
  {
    timestamps: true,
    collection: 'dicomStudies',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

dicomStudySchema.plugin(auditable);
dicomStudySchema.virtual('instanceCount').get(function instanceCount() {
  return this.instances?.length ?? 0;
});

export const DicomStudy = mongoose.model('DicomStudy', dicomStudySchema);
export default DicomStudy;
