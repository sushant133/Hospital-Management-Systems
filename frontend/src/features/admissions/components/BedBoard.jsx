import { occupancyTone } from '../../../api/admissionApi.js';
import { Card, EmptyState, Spinner } from '../../../components/ui/index.js';

/**
 * Capacity at a glance, ward by ward.
 *
 * Counts come from the beds themselves, so a bed sitting in `cleaning` or
 * `maintenance` shows as unavailable capacity rather than quietly reading as
 * free — which is the number a bed manager actually needs at 2am.
 */
export function BedBoard({ wards, totals, loading, onSelectWard, selectedWardId }) {
  if (loading) return <Spinner label="Loading the bed board…" className="py-10" />;

  if (!wards?.length) {
    return (
      <EmptyState
        icon="🛏️"
        title="No wards configured"
        description="Add wards and beds under Wards & Beds before admitting patients."
      />
    );
  }

  return (
    <div className="space-y-4">
      {totals && (
        <Card>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-2xl font-semibold text-slate-900">
                {totals.occupied}
                <span className="text-base font-normal text-slate-400"> / {totals.total}</span>
              </p>
              <p className="text-xs text-slate-500">beds occupied</p>
            </div>

            <div className="min-w-[200px] flex-1">
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${occupancyTone(totals.occupancyRate)}`}
                  style={{ width: `${Math.min(100, totals.occupancyRate)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {totals.occupancyRate}% occupancy hospital-wide
              </p>
            </div>

            <dl className="flex flex-wrap gap-4 text-sm">
              {[
                ['Available', totals.available, 'text-emerald-600'],
                ['Cleaning', totals.cleaning, 'text-amber-600'],
                ['Maintenance', totals.maintenance, 'text-red-600'],
                ['Reserved', totals.reserved, 'text-purple-600'],
              ].map(([label, value, tone]) => (
                <div key={label}>
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className={`text-lg font-semibold ${tone}`}>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {wards.map((ward) => {
          const selected = String(selectedWardId) === String(ward._id);
          return (
            <button
              key={ward._id}
              type="button"
              onClick={() => onSelectWard?.(selected ? null : ward)}
              className={[
                'rounded-xl border p-4 text-left transition-colors',
                selected
                  ? 'border-brand-400 bg-brand-50'
                  : 'border-slate-200 bg-white hover:border-slate-300',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{ward.name}</p>
                  <p className="text-xs text-slate-500">
                    {ward.code} · {ward.type} · {ward.gender}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-slate-700">
                  {ward.occupied}/{ward.total}
                </span>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${occupancyTone(ward.occupancyRate)}`}
                  style={{ width: `${Math.min(100, ward.occupancyRate)}%` }}
                />
              </div>

              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                <span className="text-emerald-600">{ward.available} free</span>
                {ward.cleaning > 0 && <span className="text-amber-600">{ward.cleaning} cleaning</span>}
                {ward.maintenance > 0 && <span className="text-red-600">{ward.maintenance} maint.</span>}
                {ward.reserved > 0 && <span className="text-purple-600">{ward.reserved} reserved</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default BedBoard;
