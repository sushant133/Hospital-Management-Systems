/**
 * A small grouped bar chart, drawn as plain SVG.
 *
 * No charting library: the app ships no chart dependency, and a revenue trend of
 * a few dozen buckets does not justify adding one. Bars are laid out in a
 * viewBox and scaled by CSS, so the chart is resolution-independent and needs no
 * measurement on mount.
 *
 * The underlying numbers are always available as a table beneath, so nothing
 * here is the only way to read the data — the chart is an aid, not the report.
 */
export function MiniBars({ series = [], keys = [], height = 160, formatLabel = (v) => v }) {
  if (series.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-slate-500">
        Nothing recorded in this range.
      </p>
    );
  }

  const max = Math.max(
    1,
    ...series.flatMap((row) => keys.map((k) => Math.abs(Number(row[k.key]) || 0))),
  );

  const groupWidth = 100 / series.length;
  const barWidth = groupWidth / (keys.length + 1);

  return (
    <div>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label={`Chart of ${keys.map((k) => k.label).join(' and ')}`}
      >
        {/* Baseline, so an all-zero range still reads as a chart rather than blank. */}
        <line x1="0" y1={height} x2="100" y2={height} stroke="currentColor" strokeWidth="0.3" className="text-slate-200" />
        {series.map((row, index) =>
          keys.map((key, keyIndex) => {
            const value = Math.abs(Number(row[key.key]) || 0);
            const barHeight = (value / max) * (height - 8);
            return (
              <rect
                key={`${row.bucket ?? index}-${key.key}`}
                x={index * groupWidth + keyIndex * barWidth + barWidth / 2}
                y={height - barHeight}
                width={barWidth * 0.85}
                height={barHeight}
                className={key.className}
              >
                <title>{`${formatLabel(row.bucket)} · ${key.label}: ${row[key.key]}`}</title>
              </rect>
            );
          }),
        )}
      </svg>

      <div className="mt-2 flex flex-wrap gap-4">
        {keys.map((key) => (
          <span key={key.key} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${key.swatch}`} aria-hidden="true" />
            {key.label}
          </span>
        ))}
      </div>

      <div className="mt-1 flex justify-between text-[11px] text-slate-400">
        <span>{formatLabel(series[0].bucket)}</span>
        {series.length > 1 && <span>{formatLabel(series[series.length - 1].bucket)}</span>}
      </div>
    </div>
  );
}

export default MiniBars;
