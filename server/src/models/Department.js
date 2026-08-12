import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';

const departmentSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Department code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: [true, 'Department name is required'], trim: true },
    description: { type: String, trim: true, default: '' },

    headOfDepartmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    floor: { type: String, trim: true },
    phone: { type: String, trim: true },
    extension: { type: String, trim: true },
  },
  {
    timestamps: true,
    collection: 'departments',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

departmentSchema.plugin(auditable);
departmentSchema.index({ name: 1 });

export const Department = mongoose.model('Department', departmentSchema);
export default Department;
