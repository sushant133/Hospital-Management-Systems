/**
 * Role identity — for *display* and for the rare "is this user the doctor on
 * this order?" identity check.
 *
 * This file deliberately no longer carries role groups or an access helper.
 * Authorization is decided by the permission matrix on the server and reaches
 * the client as an explicit grant map; see `utils/permissions.js` and
 * `useAuth().can(module, action)`. Anything that asks "may they?" belongs
 * there, not here.
 */
export const ROLES = Object.freeze({
  ADMIN: 'admin',
  DOCTOR: 'doctor',
  NURSE: 'nurse',
  RECEPTIONIST: 'receptionist',
  LAB_TECH: 'lab_tech',
  RADIOLOGIST: 'radiologist',
  PHARMACIST: 'pharmacist',
  ACCOUNTANT: 'accountant',
  STAFF: 'staff',
});

export const ROLE_VALUES = Object.values(ROLES);

export const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: 'Administrator',
  [ROLES.DOCTOR]: 'Doctor',
  [ROLES.NURSE]: 'Nurse',
  [ROLES.RECEPTIONIST]: 'Receptionist',
  [ROLES.LAB_TECH]: 'Lab Technician',
  [ROLES.RADIOLOGIST]: 'Radiologist',
  [ROLES.PHARMACIST]: 'Pharmacist',
  [ROLES.ACCOUNTANT]: 'Accountant',
  [ROLES.STAFF]: 'Staff',
});
