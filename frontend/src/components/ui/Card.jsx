export function Card({ children, className = '', padded = true, tone, interactive = false }) {
  /**
   * A left accent stripe, for a card that carries state — an overdue claim, an
   * unacknowledged alert. Deliberately opt-in: a stripe on every card is
   * decoration, and decoration that appears everywhere stops meaning anything.
   */
  const tones = {
    critical: 'border-l-2 border-l-critical-500',
    warning: 'border-l-2 border-l-warning-500',
    success: 'border-l-2 border-l-success-500',
    brand: 'border-l-2 border-l-brand-500',
  };

  return (
    <div
      className={[
        'rounded-xl border border-slate-200 bg-white shadow-card',
        interactive && 'transition-shadow hover:shadow-card-hover',
        tone && tones[tone],
        padded ? 'p-5' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className = '' }) {
  return (
    <div className={`mb-4 flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Label/value row used across detail pages.
 *
 * `inline` lays the pair side by side, which fits far more of a patient's
 * demographics into one screen than the stacked form — and a chart summary is
 * read by glancing, not by scrolling.
 */
export function DataRow({ label, value, className = '', inline = false }) {
  if (inline) {
    return (
      <div className={`flex items-baseline justify-between gap-4 py-1.5 ${className}`}>
        <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
        <dd className="min-w-0 truncate text-right text-sm font-medium text-slate-900">
          {value ?? '—'}
        </dd>
      </div>
    );
  }

  return (
    <div className={`py-2 ${className}`}>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value ?? '—'}</dd>
    </div>
  );
}

const STAT_TONES = {
  brand: { value: 'text-brand-700', accent: 'bg-brand-500', chip: 'bg-brand-50 text-brand-700' },
  emerald: { value: 'text-success-700', accent: 'bg-success-500', chip: 'bg-success-50 text-success-700' },
  success: { value: 'text-success-700', accent: 'bg-success-500', chip: 'bg-success-50 text-success-700' },
  amber: { value: 'text-warning-700', accent: 'bg-warning-500', chip: 'bg-warning-50 text-warning-800' },
  warning: { value: 'text-warning-700', accent: 'bg-warning-500', chip: 'bg-warning-50 text-warning-800' },
  critical: { value: 'text-critical-700', accent: 'bg-critical-500', chip: 'bg-critical-50 text-critical-700' },
  slate: { value: 'text-slate-800', accent: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600' },
};

/**
 * A single headline number.
 *
 * The value carries the visual weight and the label recedes — the opposite of
 * the previous version, where an uppercase caption competed with the figure it
 * described. On a dashboard scanned in two seconds, the number is the content.
 *
 * `delta` shows movement against the previous period. Direction is stated in
 * words for a screen reader rather than left to an arrow glyph, and the colour
 * is caller-supplied via `deltaGood` because "up" is good for revenue and bad
 * for mortality — the component cannot know which.
 */
export function StatCard({ label, value, hint, tone = 'brand', icon, delta, deltaGood, to }) {
  const styles = STAT_TONES[tone] ?? STAT_TONES.brand;
  const hasDelta = delta !== undefined && delta !== null && delta !== '';

  const deltaTone =
    deltaGood === undefined
      ? 'bg-slate-100 text-slate-600'
      : deltaGood
        ? 'bg-success-50 text-success-700'
        : 'bg-critical-50 text-critical-700';

  return (
    <Card className="relative overflow-hidden" interactive={Boolean(to)}>
      <span className={`absolute inset-x-0 top-0 h-0.5 ${styles.accent}`} aria-hidden="true" />

      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {icon && (
          <span className="-mt-1 text-base opacity-70" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-baseline gap-2">
        <p className={`tabular text-[1.75rem] font-semibold leading-none tracking-tight ${styles.value}`}>
          {value}
        </p>
        {hasDelta && (
          <span className={`rounded px-1.5 py-0.5 text-2xs font-semibold ${deltaTone}`}>
            {delta}
          </span>
        )}
      </div>

      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export default Card;
