export function Card({ children, className = '', padded = true }) {
  return (
    <div
      className={[
        'rounded-xl border border-slate-200 bg-white shadow-sm',
        padded ? 'p-5' : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className = '' }) {
  return (
    <div className={`mb-4 flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Label/value row used across detail pages. */
export function DataRow({ label, value, className = '' }) {
  return (
    <div className={`py-2 ${className}`}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value ?? '—'}</dd>
    </div>
  );
}

export function StatCard({ label, value, hint, tone = 'brand' }) {
  const tones = {
    brand: 'text-brand-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    slate: 'text-slate-700',
  };

  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone] ?? tones.brand}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export default Card;
