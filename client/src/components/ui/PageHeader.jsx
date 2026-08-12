export function PageHeader({ title, description, action, breadcrumb }) {
  return (
    <div className="mb-6">
      {breadcrumb && <div className="mb-2 text-sm text-slate-500">{breadcrumb}</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

export function Pagination({ meta, onPageChange }) {
  if (!meta || meta.totalPages <= 1) return null;

  const { page, totalPages, total, limit } = meta;
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-slate-500">
        Showing <span className="font-medium text-slate-700">{start}</span>–
        <span className="font-medium text-slate-700">{end}</span> of{' '}
        <span className="font-medium text-slate-700">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={!meta.hasPrevPage}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Previous
        </button>
        <span className="text-sm text-slate-600">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={!meta.hasNextPage}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default PageHeader;
