/**
 * ============================================================================
 * TABLES
 * ============================================================================
 *
 * Most of this system is worklists, and a worklist is scanned down a column
 * rather than read across a row. Three changes follow from that:
 *
 *   - a STICKY header, so a nurse forty rows into a ward list still knows which
 *     column is which;
 *   - a COMPACT density, because rows on screen is the whole currency of a
 *     worklist and the previous `py-3` bought air nobody asked for;
 *   - NUMERIC alignment, so rupee amounts and lab values line up on the decimal
 *     instead of jittering by a pixel per digit.
 *
 * The existing API (`columns`, `align`, `onClick`) is unchanged — every screen
 * already using it keeps working.
 */

export function Table({ children, className = '', stickyHeader = false }) {
  return (
    <div
      className={[
        'scroll-slim overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card',
        // A bounded height is what makes a sticky header meaningful; without it
        // the page scrolls and the header goes with it.
        stickyHeader ? 'max-h-[70vh] overflow-y-auto' : '',
        className,
      ].join(' ')}
    >
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  );
}

export function THead({ columns = [], sticky = false }) {
  return (
    <thead
      className={[
        'bg-slate-50/90 backdrop-blur',
        sticky ? 'sticky top-0 z-10 shadow-[0_1px_0_0_theme(colors.slate.200)]' : '',
      ].join(' ')}
    >
      <tr>
        {columns.map((column) => (
          <th
            key={column.key ?? column.label}
            scope="col"
            className={[
              'whitespace-nowrap px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-wider text-slate-600',
              column.align === 'right' ? 'text-right' : '',
              column.align === 'center' ? 'text-center' : '',
              column.className ?? '',
            ].join(' ')}
          >
            {column.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function TBody({ children }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>;
}

/**
 * `tone` marks a row that needs attention with a left stripe — severity in form
 * as well as colour, so it survives greyscale, a bad monitor and a printout.
 */
export function TR({ children, onClick, tone, selected = false, className = '' }) {
  const tones = {
    critical: 'row-critical',
    warning: 'row-warning',
    success: 'border-l-2 border-success-500 bg-success-50/30',
  };

  return (
    <tr
      onClick={onClick}
      // A clickable row must be reachable and activatable from the keyboard, not
      // only by mouse.
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? 'button' : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick(event);
              }
            }
          : undefined
      }
      className={[
        'transition-colors',
        onClick ? 'cursor-pointer hover:bg-brand-50/50 focus-visible:bg-brand-50' : 'hover:bg-slate-50/70',
        selected && 'bg-brand-50',
        tone && tones[tone],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </tr>
  );
}

export function TD({ children, align, numeric = false, className = '' }) {
  return (
    <td
      className={[
        'px-3 py-2 text-slate-700',
        align === 'right' || numeric ? 'text-right' : '',
        align === 'center' ? 'text-center' : '',
        // Money and lab values must line up on the decimal.
        numeric ? 'tabular font-medium text-slate-900' : '',
        className,
      ].join(' ')}
    >
      {children}
    </td>
  );
}

/** Full-width message row (loading / empty / error) inside a table body. */
export function TRMessage({ colSpan, children }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-slate-500">
        {children}
      </td>
    </tr>
  );
}

export default Table;
