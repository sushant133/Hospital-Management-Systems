export function Table({ children, className = '' }) {
  return (
    <div className={`overflow-x-auto rounded-xl border border-slate-200 bg-white ${className}`}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  );
}

export function THead({ columns = [] }) {
  return (
    <thead className="bg-slate-50">
      <tr>
        {columns.map((column) => (
          <th
            key={column.key ?? column.label}
            scope="col"
            className={[
              'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600',
              column.align === 'right' ? 'text-right' : '',
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

export function TR({ children, onClick, className = '' }) {
  return (
    <tr
      onClick={onClick}
      className={[
        onClick ? 'cursor-pointer hover:bg-slate-50' : 'hover:bg-slate-50/60',
        className,
      ].join(' ')}
    >
      {children}
    </tr>
  );
}

export function TD({ children, align, className = '' }) {
  return (
    <td
      className={[
        'px-4 py-3 text-slate-700',
        align === 'right' ? 'text-right' : '',
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
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-500">
        {children}
      </td>
    </tr>
  );
}

export default Table;
