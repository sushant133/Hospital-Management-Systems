/**
 * ============================================================================
 * STATUS, SEVERITY AND EMPTY STATES
 * ============================================================================
 *
 * The vocabulary the whole system speaks when something needs attention.
 *
 * Existing tone names (`neutral`, `success`, `warning`, `danger`, `info`,
 * `purple`) are all preserved, because ~30 screens already use them. What is
 * added is a `critical` tone that outranks `danger` visually, and severity
 * encoded in FORM as well as colour — a dot, a ring, a stripe — so a warning
 * still reads on a washed-out ward monitor, to a colour-blind clinician, and on
 * a printed worklist. None of those is an edge case here.
 */

const BADGE_TONES = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-success-50 text-success-700 ring-success-200',
  warning: 'bg-warning-50 text-warning-800 ring-warning-200',
  danger: 'bg-critical-50 text-critical-700 ring-critical-200',
  /**
   * Above `danger`: solid rather than tinted, so it separates itself from a
   * column of ordinary red badges. For contraindications and unacknowledged
   * critical results — the things that can kill someone.
   */
  critical: 'bg-critical-600 text-white ring-critical-700',
  info: 'bg-brand-50 text-brand-700 ring-brand-200',
  purple: 'bg-purple-50 text-purple-700 ring-purple-200',
};

/**
 * ---------------------------------------------------------------------------
 * TONE ALIASES — these fix a real bug, not a style preference
 * ---------------------------------------------------------------------------
 * Screens across the app pass colour-flavoured tone names (`amber`, `emerald`,
 * `error`, `slate`, `brand`) that were never in the map above. The lookup fell
 * through its `??` default, so every one of them has been silently rendering as
 * a grey `neutral` badge — roughly 40 places where a status meant to read as
 * "overdue" or "settled" read as nothing at all.
 *
 * Mapping them to their intended meaning is the smaller change; renaming 40
 * call sites would be churn with the same outcome. New code should prefer the
 * semantic names.
 */
const TONE_ALIASES = {
  amber: 'warning',
  emerald: 'success',
  error: 'danger',
  slate: 'neutral',
  brand: 'info',
};

const resolveTone = (tone) => TONE_ALIASES[tone] ?? tone;

/** Dot colours, so a badge reads without relying on its background. */
const DOT_TONES = {
  neutral: 'bg-slate-400',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-critical-500',
  critical: 'bg-white',
  info: 'bg-brand-500',
  purple: 'bg-purple-500',
};

export function Badge({ tone = 'neutral', dot = false, children, className = '' }) {
  const key = resolveTone(tone);
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5',
        'text-xs font-medium ring-1 ring-inset',
        BADGE_TONES[key] ?? BADGE_TONES.neutral,
        className,
      ].join(' ')}
    >
      {dot && (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_TONES[key] ?? DOT_TONES.neutral}`}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

/**
 * A bare status dot, for table cells where a full badge is too heavy.
 * Carries its own accessible label — a colour alone is not a status.
 */
export function StatusDot({ tone = 'neutral', label, pulse = false, className = '' }) {
  const key = resolveTone(tone);
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className={[
          'h-2 w-2 shrink-0 rounded-full',
          DOT_TONES[key] ?? DOT_TONES.neutral,
          key === 'critical' ? 'bg-critical-600' : '',
          pulse ? 'animate-pulse-critical' : '',
        ].join(' ')}
        aria-hidden="true"
      />
      {label && <span className="text-sm text-slate-700">{label}</span>}
      <span className="sr-only">{label ? `${label}, ` : ''}{tone}</span>
    </span>
  );
}

const ALERT_TONES = {
  error: {
    box: 'bg-critical-50 text-critical-900 border-critical-200',
    bar: 'bg-critical-500',
    icon: '⚠',
  },
  critical: {
    box: 'bg-critical-50 text-critical-900 border-critical-300 ring-1 ring-critical-200',
    bar: 'bg-critical-600',
    icon: '⚠',
  },
  success: {
    box: 'bg-success-50 text-success-900 border-success-200',
    bar: 'bg-success-500',
    icon: '✓',
  },
  warning: {
    box: 'bg-warning-50 text-warning-900 border-warning-200',
    bar: 'bg-warning-500',
    icon: '!',
  },
  info: { box: 'bg-brand-50 text-brand-900 border-brand-200', bar: 'bg-brand-500', icon: 'i' },
  /** Pages pass these; without them the lookup fell through to `info`. */
  neutral: { box: 'bg-slate-50 text-slate-800 border-slate-200', bar: 'bg-slate-400', icon: 'i' },
  danger: { box: 'bg-critical-50 text-critical-900 border-critical-200', bar: 'bg-critical-500', icon: '⚠' },
};

export function Alert({ tone = 'info', title, children, onDismiss, className = '' }) {
  const styles = ALERT_TONES[tone] ?? ALERT_TONES.info;
  const urgent = ['error', 'critical', 'danger'].includes(tone);

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={[
        // The leading bar is the point: it survives greyscale and a bad screen,
        // where a pale tinted background does not.
        'relative overflow-hidden rounded-lg border pl-4 pr-4 py-3 text-sm',
        styles.box,
        className,
      ].join(' ')}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${styles.bar}`} aria-hidden="true" />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <span
            className={[
              'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
              'text-[10px] font-bold text-white',
              styles.bar,
            ].join(' ')}
            aria-hidden="true"
          >
            {styles.icon}
          </span>
          <div className="min-w-0">
            {title && <p className="font-semibold">{title}</p>}
            {children && <div className={title ? 'mt-0.5 opacity-90' : 'opacity-90'}>{children}</div>}
          </div>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="-mr-1 shrink-0 rounded p-1 text-lg leading-none opacity-50 transition-opacity hover:opacity-100"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Nothing to show.
 *
 * An empty state should say why it is empty and what to do next. "No records"
 * on its own leaves a user unsure whether the filter is wrong, the data has not
 * loaded, or there genuinely is nothing.
 */
export function EmptyState({ title, description, action, icon = '📋', className = '' }) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300',
        'bg-white/60 px-6 py-14 text-center',
        className,
      ].join(' ')}
    >
      <div
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl"
        aria-hidden="true"
      >
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * A skeleton placeholder.
 *
 * Better than a centred spinner for list and card layouts: it holds the shape
 * the content will take, so the page does not jump when data lands. On a slow
 * ward connection that reflow is the difference between a page that feels
 * broken and one that feels merely slow.
 */
export function Skeleton({ className = '', rows = 1 }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`animate-pulse rounded bg-slate-200/70 ${className || 'h-4 w-full'}`} />
      ))}
    </div>
  );
}

export default Badge;
