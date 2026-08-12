/**
 * Display formatting. Names and ages are composed here rather than sent by the
 * API: list endpoints use lean queries (no Mongoose virtuals), so the client is
 * the single place that knows how to render a person.
 */

export function fullName(person) {
  if (!person) return '—';
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ');
  return name || '—';
}

export function initials(person) {
  if (!person) return '?';
  return (
    [person.firstName?.[0], person.lastName?.[0]].filter(Boolean).join('').toUpperCase() || '?'
  );
}

/** Whole years from a date of birth. */
export function ageFrom(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) years -= 1;
  return years >= 0 ? years : null;
}

export function formatDate(value, { withTime = false } = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  if (withTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }
  return date.toLocaleDateString(undefined, options);
}

/** yyyy-mm-dd for <input type="date"> values. */
export function toDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function titleCase(value) {
  if (!value) return '—';
  return String(value)
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Human label for a role string, e.g. lab_tech -> "Lab Tech". */
export function roleLabel(role) {
  return titleCase(role);
}

export function formatCurrency(amount, currency = 'USD') {
  if (amount === null || amount === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return String(amount);
  }
}
