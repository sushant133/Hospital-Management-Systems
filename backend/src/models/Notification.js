import mongoose from 'mongoose';

const { Schema } = mongoose;

export const NOTIFICATION_TYPES = [
  'appointment',
  'lab-critical',
  'radiology-critical',
  'triage',
  'system',
  'blood',
  'maternity',
  'cds',
  'portal',
];

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true, index: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, trim: true, default: '' },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null },
    resourceType: { type: String, trim: true, default: '' },
    resourceId: { type: Schema.Types.ObjectId, default: null },
    readAt: { type: Date, default: null },
    channel: { type: String, enum: ['in-app', 'webhook', 'both'], default: 'in-app' },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'notifications',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
  },
);

notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

export const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
