import { Link } from 'react-router-dom';
import { ageFrom, formatDate, fullName } from '../../lib/format.js';
import { Alert, Badge, Card } from '../../components/ui/index.js';

/**
 * Shows records the MPI thinks might already be this person.
 *
 * The point is to make the warning *actionable*: the receptionist sees which
 * fields matched and can open the existing chart in a new tab to check. A
 * warning that only says "possible duplicate" gets dismissed reflexively; one
 * that says "same phone and date of birth as MRN-000042" gets read.
 */
function MatchRow({ match }) {
  const { patient, score, matchedOn, confidence } = match;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-t border-slate-200 py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/patients/${patient._id}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-slate-900 hover:text-brand-600"
          >
            {fullName(patient)}
          </Link>
          <Badge tone="info">{patient.mrn}</Badge>
          <Badge tone={confidence === 'high' ? 'danger' : 'warning'}>{score}% match</Badge>
          {!patient.isActive && <Badge tone="neutral">Deactivated</Badge>}
        </div>

        <p className="mt-1 text-xs text-slate-500">
          {ageFrom(patient.dateOfBirth) ?? '—'} yrs · {patient.gender ?? '—'} ·{' '}
          {patient.phone ?? 'no phone'} · registered {formatDate(patient.createdAt)}
        </p>

        <p className="mt-1 text-xs text-slate-600">
          <span className="text-slate-400">Matches on:</span> {matchedOn.join(', ')}
        </p>
      </div>
    </li>
  );
}

export function DuplicateWarning({
  matches = [],
  blocking = false,
  acknowledged,
  onAcknowledgeChange,
  reason,
  onReasonChange,
  canOverride = false,
}) {
  if (matches.length === 0) return null;

  return (
    <Card className="mb-4 border-amber-300 bg-amber-50/60">
      <Alert tone={blocking ? 'error' : 'warning'} title={
        blocking
          ? 'This person may already be registered'
          : 'Similar records found'
      }>
        {blocking
          ? 'Open the matching record instead of creating a second chart. Registering a duplicate splits the patient’s allergies, history and bills across two records.'
          : 'These records look similar. Check them before continuing.'}
      </Alert>

      <ul className="mt-3">
        {matches.map((match) => (
          <MatchRow key={match.patient._id} match={match} />
        ))}
      </ul>

      {blocking && (
        <div className="mt-4 border-t border-amber-300 pt-4">
          {canOverride ? (
            <>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={acknowledged}
                  onChange={(event) => onAcknowledgeChange(event.target.checked)}
                />
                <span>
                  I have checked the records above and this is a <strong>different person</strong>.
                </span>
              </label>

              {acknowledged && (
                <div className="mt-3">
                  <label
                    htmlFor="duplicate-override-reason"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Why is this a different person?
                  </label>
                  <textarea
                    id="duplicate-override-reason"
                    className="form-control"
                    rows={2}
                    value={reason}
                    onChange={(event) => onReasonChange(event.target.value)}
                    placeholder="e.g. Twin sibling, same date of birth and household phone number."
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Recorded in the audit log against your account.
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-600">
              Your role cannot register a patient over a duplicate warning. Ask the records desk or
              an administrator to review.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

export default DuplicateWarning;
