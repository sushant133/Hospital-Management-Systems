import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  adToBs,
  bsToAd,
  todayBs,
  formatBsIso,
  parseBsString,
  bsMonthGrid,
  daysInBsMonth,
  toNepaliDigits,
  fromNepaliDigits,
  BS_MONTHS_NE,
  BS_MONTHS_EN,
  BS_WEEKDAYS_SHORT_NE,
  BS_WEEKDAYS_EN,
  MIN_BS_YEAR,
  MAX_BS_YEAR,
} from '../../utils/nepal.js';
import { useI18n } from '../../i18n/I18nContext.jsx';

/**
 * ============================================================================
 * BIKRAM SAMBAT DATE INPUT
 * ============================================================================
 *
 * Replaces `<input type="date">` everywhere a human types or reads a date.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT
 * ---------------------------------------------------------------------------
 * The *value* in and out is always a Gregorian ISO date string — what the API
 * stores. Only the display and the typing are BS. Keeping the wire format
 * Gregorian means no server code, index, or export has to know this component
 * exists, and there is no risk of a BS string reaching the database.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT JUST A TEXT BOX
 * ---------------------------------------------------------------------------
 * Because BS month lengths vary between 29 and 32 days with no pattern, so a
 * user cannot know whether Poush has 29 or 30 days this year. Typing is
 * supported (fast for staff who know the date), but the calendar grid is what
 * makes the input correct: it can only offer days that exist.
 */
export default function NepaliDateInput({
  value,
  onChange,
  id,
  name,
  disabled = false,
  required = false,
  /** Restrict to dates at or before today — for a date of birth. */
  maxToday = false,
  /** Restrict to dates at or after today — for an appointment. */
  minToday = false,
  placeholder,
  className = '',
  error,
}) {
  const { locale, t } = useI18n();
  const isNepali = locale === 'ne';
  const months = isNepali ? BS_MONTHS_NE : BS_MONTHS_EN;
  const weekdays = isNepali ? BS_WEEKDAYS_SHORT_NE : BS_WEEKDAYS_EN.map((d) => d.slice(0, 3));

  /** The BS date currently selected, or null. */
  const selected = useMemo(() => {
    if (!value) return null;
    try {
      return adToBs(new Date(value));
    } catch {
      // Out of the conversion table — show it as empty rather than crashing the
      // form. The validation message below explains why.
      return null;
    }
  }, [value]);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => (selected ? formatBsIso(selected) : ''));
  const [view, setView] = useState(() => selected || todayBs());
  const [typingError, setTypingError] = useState('');
  const containerRef = useRef(null);

  // Keep the text box in step when the form sets the value from outside.
  useEffect(() => {
    setText(selected ? formatBsIso(selected) : '');
    if (selected) setView(selected);
  }, [selected]);

  // Close on an outside click — a calendar that traps the page is worse than
  // no calendar.
  useEffect(() => {
    if (!open) return undefined;
    const onDocumentClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [open]);

  const today = useMemo(() => todayBs(), []);

  const outOfRange = useCallback(
    (bs) => {
      if (!bs) return false;
      const asAd = bsToAd(bs.year, bs.month, bs.day);
      const now = new Date();
      if (maxToday && asAd > now) return true;
      if (minToday) {
        const startOfToday = bsToAd(today.year, today.month, today.day);
        if (asAd < startOfToday) return true;
      }
      return false;
    },
    [maxToday, minToday, today],
  );

  const commit = useCallback(
    (bs) => {
      if (!bs) {
        onChange?.('');
        return;
      }
      const asAd = bsToAd(bs.year, bs.month, bs.day);
      // ISO date only — the time component is meaningless for a calendar date
      // and would otherwise drift the day across timezones on the way back.
      onChange?.(asAd.toISOString());
      setTypingError('');
    },
    [onChange],
  );

  /** Accept "2081-04-15", "2081/4/15", and Devanagari digits. */
  const handleTyping = (raw) => {
    const normalised = fromNepaliDigits(raw);
    setText(normalised);

    if (!normalised.trim()) {
      setTypingError('');
      commit(null);
      return;
    }

    const parsed = parseBsString(normalised);
    if (!parsed) {
      // Only complain once the string is long enough to be a real attempt —
      // scolding someone mid-keystroke is noise.
      setTypingError(normalised.length >= 8 ? t('msg.invalidDate') : '');
      return;
    }
    if (parsed.year < MIN_BS_YEAR || parsed.year > MAX_BS_YEAR) {
      setTypingError(`${MIN_BS_YEAR}–${MAX_BS_YEAR}`);
      return;
    }
    if (outOfRange(parsed)) {
      setTypingError(maxToday ? t('msg.invalidDate') : t('msg.invalidDate'));
      return;
    }
    setTypingError('');
    setView(parsed);
    commit(parsed);
  };

  const shiftMonth = (delta) => {
    let { year, month } = view;
    month += delta;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    if (year < MIN_BS_YEAR || year > MAX_BS_YEAR) return;
    // Clamp the day: moving from a 32-day month into a 29-day one must not
    // produce a day that does not exist.
    const day = Math.min(view.day, daysInBsMonth(year, month));
    setView({ year, month, day });
  };

  const grid = useMemo(() => bsMonthGrid(view.year, view.month), [view.year, view.month]);

  const yearOptions = useMemo(() => {
    // A date of birth needs a deep list; a future appointment does not.
    const from = maxToday ? MIN_BS_YEAR : today.year - 1;
    const to = minToday ? today.year + 5 : Math.min(MAX_BS_YEAR, today.year + 5);
    const years = [];
    for (let y = to; y >= from; y -= 1) years.push(y);
    return years;
  }, [maxToday, minToday, today.year]);

  const digits = (n) => (isNepali ? toNepaliDigits(n) : String(n));
  const shownError = error || typingError;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex">
        <input
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          required={required}
          value={isNepali ? toNepaliDigits(text) : text}
          onChange={(e) => handleTyping(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder || (isNepali ? 'वि.सं. २०८१-०४-१५' : 'BS 2081-04-15')}
          aria-invalid={shownError ? 'true' : undefined}
          className={`w-full rounded-l border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
            shownError
              ? 'border-red-400 focus:ring-red-200'
              : 'border-slate-300 focus:ring-blue-200'
          }`}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-label={isNepali ? 'पात्रो खोल्नुहोस्' : 'Open calendar'}
          className="rounded-r border border-l-0 border-slate-300 px-3 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
        >
          📅
        </button>
      </div>

      {/* The Gregorian equivalent, always visible. Staff cross-check against
          lab machines, referral letters and insurance portals that print AD. */}
      {selected && !shownError && (
        <p className="mt-1 text-xs text-slate-500">
          {isNepali ? 'ई.सं.' : 'AD'}{' '}
          {bsToAd(selected.year, selected.month, selected.day).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </p>
      )}
      {shownError && <p className="mt-1 text-xs text-red-600">{shownError}</p>}

      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-72 rounded border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
              aria-label={isNepali ? 'अघिल्लो महिना' : 'Previous month'}
            >
              ‹
            </button>

            <select
              value={view.month}
              onChange={(e) => setView({ ...view, month: Number(e.target.value) })}
              className="flex-1 rounded border border-slate-300 px-1 py-1 text-sm"
              aria-label={isNepali ? 'महिना' : 'Month'}
            >
              {months.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </select>

            <select
              value={view.year}
              onChange={(e) => setView({ ...view, year: Number(e.target.value) })}
              className="rounded border border-slate-300 px-1 py-1 text-sm"
              aria-label={isNepali ? 'वर्ष' : 'Year'}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {digits(y)}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
              aria-label={isNepali ? 'अर्को महिना' : 'Next month'}
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-slate-500">
            {weekdays.map((day) => (
              <div key={day} className="py-1 font-medium">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center text-sm">
            {grid.flat().map((day, index) => {
              if (day === null) return <div key={`pad-${index}`} />;

              const cell = { year: view.year, month: view.month, day };
              const isSelected =
                selected &&
                selected.year === cell.year &&
                selected.month === cell.month &&
                selected.day === cell.day;
              const isToday =
                today.year === cell.year && today.month === cell.month && today.day === cell.day;
              const blocked = outOfRange(cell);

              return (
                <button
                  key={day}
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    commit(cell);
                    setOpen(false);
                  }}
                  className={[
                    'rounded py-1',
                    blocked && 'cursor-not-allowed text-slate-300',
                    !blocked && !isSelected && 'hover:bg-blue-50',
                    isSelected && 'bg-blue-600 text-white',
                    isToday && !isSelected && 'ring-1 ring-blue-400',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {digits(day)}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-xs">
            <button
              type="button"
              onClick={() => {
                if (outOfRange(today)) return;
                setView(today);
                commit(today);
                setOpen(false);
              }}
              className="text-blue-700 hover:underline"
            >
              {t('date.today')}
            </button>
            <button
              type="button"
              onClick={() => {
                commit(null);
                setText('');
                setOpen(false);
              }}
              className="text-slate-500 hover:underline"
            >
              {t('action.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
