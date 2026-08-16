import { formatNpr, formatAdAsBs, formatAge as formatNepaliAge } from './nepal.js';

/**
 * Display formatting. Names and ages are composed here rather than sent by the
 * API: list endpoints use lean queries (no Mongoose virtuals), so the client is
 * the single place that knows how to render a person.
 *
 * Dates and money route through the shared Nepal modules — Bikram Sambat and
 * NPR are not a presentation preference here, they are what the user reads.
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

/**
 * A date as a user reads it.
 * English mode uses the Gregorian calendar. Nepali mode uses Bikram Sambat.
 */
function currentLocale() {
  if (typeof localStorage === 'undefined') return 'en';
  return localStorage.getItem('hms.locale.v2') || localStorage.getItem('hms.locale') || 'en';
}

export function formatDate(value, { withTime = false, calendar, locale } = {}) {
  const loc = locale || currentLocale();
  const cal = calendar || (loc === 'ne' ? 'bs' : 'ad');
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  if (cal === 'bs') {
    try {
      const bs = formatAdAsBs(date, { locale: loc });
      if (!withTime) return bs;
      const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      return `${bs} ${time}`;
    } catch {
      // Outside the BS conversion table — a very old date of birth, say.
      // Fall through to Gregorian rather than rendering nothing.
    }
  }

  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  if (withTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }
  return date.toLocaleDateString('en-GB', options);
}

/** Age as a clinician reads it: years, months for infants, days for neonates. */
export function formatAge(dateOfBirth, options = {}) {
  return formatNepaliAge(dateOfBirth, { locale: currentLocale(), ...options });
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

/**
 * Money. Always NPR, always grouped the South Asian way (12,34,567.89).
 *
 * Delegates to the shared `formatNpr` rather than to `Intl`: a clinic PC may
 * carry any locale, ICU data varies by browser, and a bill whose grouping
 * changes between two machines is a compliance problem, not a cosmetic one.
 */
export function formatCurrency(amount, options) {
  return formatNpr(amount, options);
}
