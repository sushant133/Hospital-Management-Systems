import { Spinner } from '../../../components/ui/index.js';

/**
 * A doctor's slot grid for one day.
 *
 * Taken slots are rendered too, disabled — a half-empty grid tells the desk
 * "this doctor is busy", whereas hiding them just looks like no clinic.
 */
export function DoctorCalendar({ slots, loading, selected, onSelect, emptyMessage }) {
  if (loading) return <Spinner label="Loading slots…" className="py-10" />;

  if (!slots?.length) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
        {emptyMessage ?? 'No clinic published for this day.'}
      </p>
    );
  }

  if (slots.length === 1 && slots[0].blockedReason === 'on-leave') {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 py-8 text-center text-sm text-amber-900">
        This doctor is on leave that day — no slots can be booked.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {slots.map((slot) => {
        const isSelected = selected === slot.start;
        const disabled = !slot.available;

        return (
          <button
            key={slot.start}
            type="button"
            disabled={disabled}
            onClick={() => onSelect?.(slot)}
            title={
              slot.blockedReason === 'on-leave'
                ? 'Doctor on leave'
                : slot.isPast
                  ? 'This time has passed'
                  : disabled
                    ? `Full — ${slot.booked}/${slot.capacity} booked`
                    : `${slot.durationMinutes} minutes`
            }
            className={[
              'rounded-lg border px-2 py-2 text-sm font-medium transition-colors',
              isSelected
                ? 'border-brand-500 bg-brand-600 text-white'
                : disabled
                  ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 line-through'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-brand-400 hover:bg-brand-50',
            ].join(' ')}
          >
            {slot.time}
            {slot.capacity > 1 && !disabled && (
              <span className="ml-1 text-[10px] opacity-70">
                {slot.capacity - slot.booked} left
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default DoctorCalendar;
