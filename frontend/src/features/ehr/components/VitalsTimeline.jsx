import { VITAL_FIELDS, VITAL_FLAG_TONES, VITAL_FLAG_LABELS } from '../../../api/ehrApi.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Badge, EmptyState, Spinner, Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

/**
 * The observation series as a grid: one row per reading, one column per
 * measurement, flagged values called out.
 *
 * Reading down a column is how a clinician spots a trend, so the measurements
 * stay in fixed columns even when a given reading skipped some of them.
 */
const COLUMNS = [
  { key: 'when', label: 'Recorded' },
  ...VITAL_FIELDS.map((field) => ({ key: field.key, label: `${field.label} (${field.unit})` })),
  { key: 'bmi', label: 'BMI' },
  { key: 'by', label: 'By' },
];

export function VitalsTimeline({ series, loading, emptyMessage }) {
  if (loading) return <Spinner label="Loading observations…" className="py-8" />;

  if (!series?.length) {
    return (
      <EmptyState
        icon="💓"
        title="No observations recorded"
        description={emptyMessage ?? 'Recorded observations appear here, newest at the bottom.'}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <THead columns={COLUMNS} />
        <TBody>
          {series.length === 0 && <TRMessage colSpan={COLUMNS.length}>Nothing recorded.</TRMessage>}
          {series.map((reading) => (
            <TR key={reading._id}>
              <TD>
                <div className="whitespace-nowrap text-sm">
                  {formatDate(reading.recordedAt, { withTime: true })}
                </div>
                {reading.hasCritical && <Badge tone="danger">critical</Badge>}
              </TD>

              {VITAL_FIELDS.map((field) => {
                const value = reading[field.key];
                const flag = reading.flags?.[field.key];
                const abnormal = flag && flag !== 'normal';

                return (
                  <TD key={field.key}>
                    {value === undefined || value === null ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <span
                        className={abnormal ? 'font-semibold text-slate-900' : 'text-slate-700'}
                        title={abnormal ? VITAL_FLAG_LABELS[flag] : undefined}
                      >
                        {value}
                        {abnormal && (
                          <Badge tone={VITAL_FLAG_TONES[flag] ?? 'neutral'} className="ml-1">
                            {flag === 'critical-low' || flag === 'low' ? '↓' : '↑'}
                          </Badge>
                        )}
                      </span>
                    )}
                  </TD>
                );
              })}

              <TD>{reading.bmi ?? <span className="text-slate-300">—</span>}</TD>
              <TD>
                <span className="whitespace-nowrap text-xs text-slate-500">
                  {fullName(reading.recordedBy)}
                </span>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

export default VitalsTimeline;
