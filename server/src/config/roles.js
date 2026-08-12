/**
 * The nine roles in the system.
 *
 * Kept in its own module (rather than in config/index.js) so that
 * `permissions.js` can import it without pulling in environment validation —
 * the permission matrix must be importable by tests and tooling that have no
 * .env file.
 *
 * Stored in the DB as snake_case. Mirrored on the client only as *labels*; the
 * client receives its effective permissions from the server (GET /auth/me),
 * so this list does not need a hand-maintained client-side twin.
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

export const ROLE_VALUES = Object.freeze(Object.values(ROLES));

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

export default ROLES;
