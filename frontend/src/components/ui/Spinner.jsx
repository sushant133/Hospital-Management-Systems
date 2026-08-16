export function Spinner({ label, size = 'md', className = '' }) {
  const dimension = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-10 w-10' }[size] ?? 'h-6 w-6';

  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`} role="status">
      <svg className={`${dimension} animate-spin text-brand-600`} viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      {label && <p className="text-sm text-slate-500">{label}</p>}
      <span className="sr-only">Loading</span>
    </div>
  );
}

export default Spinner;
