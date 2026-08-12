const BADGE_TONES = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-brand-50 text-brand-700 ring-brand-200',
  purple: 'bg-purple-50 text-purple-700 ring-purple-200',
};

export function Badge({ tone = 'neutral', children, className = '' }) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        BADGE_TONES[tone] ?? BADGE_TONES.neutral,
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}

const ALERT_TONES = {
  error: 'bg-red-50 text-red-800 border-red-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  info: 'bg-brand-50 text-brand-800 border-brand-200',
};

export function Alert({ tone = 'info', title, children, onDismiss, className = '' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={[
        'rounded-lg border px-4 py-3 text-sm',
        ALERT_TONES[tone] ?? ALERT_TONES.info,
        className,
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded p-0.5 text-lg leading-none opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon = '📋' }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="mb-3 text-3xl" aria-hidden="true">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export default Badge;
