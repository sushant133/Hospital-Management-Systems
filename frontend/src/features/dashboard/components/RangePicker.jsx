import { RANGE_PRESETS, lastDays } from '../../../api/reportApi.js';
import { Button, Input } from '../../../components/ui/index.js';

/**
 * The date range every report shares.
 *
 * Presets first because that is how the question is usually asked ("last 30
 * days"), with explicit dates underneath for the month-end close, when the exact
 * boundary matters and "30 days ago" is the wrong answer.
 */
export function RangePicker({ range, onChange, children }) {
  const applyPreset = (days) => onChange(lastDays(days));

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex gap-1" role="group" aria-label="Range presets">
        {RANGE_PRESETS.map((preset) => {
          const active = range.from === lastDays(preset.days).from && range.to === lastDays(preset.days).to;
          return (
            <Button
              key={preset.days}
              size="sm"
              variant={active ? 'primary' : 'secondary'}
              onClick={() => applyPreset(preset.days)}
            >
              {preset.label}
            </Button>
          );
        })}
      </div>

      <div className="w-40">
        <Input
          label="From"
          type="date"
          value={range.from}
          max={range.to}
          onChange={(event) => onChange({ ...range, from: event.target.value })}
        />
      </div>
      <div className="w-40">
        <Input
          label="To"
          type="date"
          value={range.to}
          min={range.from}
          onChange={(event) => onChange({ ...range, to: event.target.value })}
        />
      </div>

      <div className="ml-auto flex items-end gap-2">{children}</div>
    </div>
  );
}

export default RangePicker;
