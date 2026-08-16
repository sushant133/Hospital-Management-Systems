import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { MODULES, actionsFor } from '../config/permissions.js';

const { Schema } = mongoose;

/**
 * ============================================================================
 * CUSTOM ROLES AND SCOPED PERMISSIONS (D8)
 * ============================================================================
 *
 * Nine hard-coded roles cover a clinic. A 300-bed hospital needs a medical
 * superintendent, a matron, a ward in-charge, an MRD officer, a store keeper, a
 * billing supervisor and a biomedical engineer — and needs to create the tenth
 * without a code release.
 *
 * ---------------------------------------------------------------------------
 * COMPOSED FROM THE EXISTING MATRIX, NOT BESIDE IT
 * ---------------------------------------------------------------------------
 * A custom role is a named set of (module, action) pairs drawn from the same
 * permission matrix everything else already uses. It is emphatically NOT a
 * second authorisation system: `can()` remains the single question, and a
 * custom role simply widens the set of answers available to it. Two parallel
 * systems would diverge, and the one nobody remembers to check is the one that
 * grants too much.
 *
 * ---------------------------------------------------------------------------
 * SCOPE IS THE POINT
 * ---------------------------------------------------------------------------
 * A ward in-charge manages *their* ward, not every ward. The base role model
 * has no way to say that, so a hospital either over-grants (every nurse can
 * change every bed) or under-grants (nobody can, and admin does it all). Scope
 * narrows a grant to named departments, wards or facilities.
 */
const grantSchema = new Schema(
  {
    module: { type: String, required: true },
    actions: { type: [String], required: true },
  },
  { _id: false },
);

const customRoleSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    name: { type: String, required: true, trim: true },
    nameNe: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },

    /**
     * The base role a holder still carries.
     *
     * A custom role ADDS to a base rather than replacing it, because every
     * clinical control in the system keys off the base role — a "ward in-charge"
     * is still a nurse, and losing that would silently remove their ability to
     * chart. Custom roles grant; they never revoke.
     */
    baseRole: { type: String, required: true },

    grants: { type: [grantSchema], default: [] },

    /**
     * Where the grants apply. Empty means hospital-wide, which is the right
     * default for a superintendent and the wrong one for a ward in-charge —
     * so it is set deliberately rather than defaulted into.
     */
    scope: {
      departmentIds: { type: [Schema.Types.ObjectId], ref: 'Department', default: [] },
      wardIds: { type: [Schema.Types.ObjectId], ref: 'Ward', default: [] },
      facilityIds: { type: [Schema.Types.ObjectId], ref: 'Facility', default: [] },
    },

    /** Temporary elevation: acting-up cover that expires by itself. */
    expiresAt: { type: Date, default: null, index: true },
  },
  {
    timestamps: true,
    collection: 'customRoles',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

customRoleSchema.plugin(auditable);

/**
 * Every grant must name a real (module, action) pair.
 *
 * The same validation `requirePermission` does at boot, applied here at write
 * time — otherwise a typo in an admin form creates a role granting a permission
 * that can never match anything, and the holder is quietly denied with no
 * explanation anyone can find.
 */
customRoleSchema.path('grants').validate(function validateGrants(grants) {
  for (const grant of grants || []) {
    const known = Object.values(MODULES).includes(grant.module);
    if (!known) return false;
    const valid = actionsFor(grant.module);
    if ((grant.actions || []).some((action) => !valid.includes(action))) return false;
  }
  return true;
}, 'A grant names a module or action that does not exist in the permission matrix.');

/** Live on a given date — an expired acting-up role grants nothing. */
customRoleSchema.methods.isEffectiveOn = function isEffectiveOn(date = new Date()) {
  if (!this.isActive) return false;
  return !this.expiresAt || new Date(this.expiresAt) > date;
};

/** True when this role's grants are limited to particular places. */
customRoleSchema.virtual('isScoped').get(function scoped() {
  const { departmentIds = [], wardIds = [], facilityIds = [] } = this.scope || {};
  return departmentIds.length + wardIds.length + facilityIds.length > 0;
});

export const CustomRole = mongoose.model('CustomRole', customRoleSchema);
export default CustomRole;
