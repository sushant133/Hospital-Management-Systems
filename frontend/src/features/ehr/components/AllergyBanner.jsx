import { Alert, Badge } from '../../../components/ui/index.js';

const SEVERITY_TONES = { severe: 'danger', moderate: 'warning', mild: 'neutral' };

/**
 * Known allergies, shown at the top of anything clinical.
 *
 * Deliberately loud and never collapsed: this is the one piece of the chart
 * that must be read before prescribing or dispensing. "No known allergies" is
 * rendered explicitly too — absence of a banner is ambiguous, and silence
 * should not be mistaken for a clear history.
 */
export function AllergyBanner({ allergies, className = '' }) {
  if (!Array.isArray(allergies)) return null;

  if (allergies.length === 0) {
    return (
      <div
        className={`rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 ${className}`}
      >
        <span aria-hidden="true">✓</span> No known allergies recorded
      </div>
    );
  }

  const worst = allergies.some((a) => a.severity === 'severe') ? 'error' : 'warning';

  return (
    <Alert tone={worst} title="Allergies" className={className}>
      <div className="flex flex-wrap gap-2">
        {allergies.map((allergy, index) => (
          <span
            key={`${allergy.substance}-${index}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-white/70 px-2 py-1 text-sm"
          >
            <span className="font-semibold">{allergy.substance}</span>
            {allergy.severity && (
              <Badge tone={SEVERITY_TONES[allergy.severity] ?? 'neutral'}>{allergy.severity}</Badge>
            )}
            {allergy.reaction && (
              <span className="text-xs text-slate-600">· {allergy.reaction}</span>
            )}
          </span>
        ))}
      </div>
    </Alert>
  );
}

export default AllergyBanner;
