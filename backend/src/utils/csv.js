/**
 * CSV serialisation for report exports.
 *
 * Reports are read by finance and administration in Excel, which is why this is
 * more careful than a `rows.join(',')`.
 */

/**
 * Cells beginning with these characters are interpreted as FORMULAS by Excel,
 * LibreOffice and Google Sheets when the file is opened.
 *
 * Report data includes free text an ordinary user typed — department names,
 * item descriptions, cancellation reasons. A supplier named `=cmd|...` or a note
 * beginning with `@` becomes executable content in the reader's spreadsheet, so
 * every such cell is prefixed with an apostrophe, which those programs strip on
 * display and treat as "this is text". This is CSV injection, and the export is
 * the only place in the system where hospital text lands in a formula engine.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value) {
  if (value === null || value === undefined) return '';

  // Dates go out in ISO so a spreadsheet parses them the same way everywhere.
  const raw = value instanceof Date ? value.toISOString() : String(value);

  const neutralised = FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;

  // Quote when the cell contains a delimiter, a quote or a newline; double up
  // any embedded quotes, per RFC 4180.
  return /[",\n\r]/.test(neutralised) ? `"${neutralised.replace(/"/g, '""')}"` : neutralised;
}

/**
 * Render rows as CSV text.
 *
 *   toCsv(rows, [{ key: 'name', label: 'Item' }, { key: 'issued', label: 'Issued' }])
 *
 * `columns` is explicit rather than derived from the first row's keys: a report
 * whose first row happens to be missing an optional field would otherwise drop
 * that column from the whole export.
 */
export function toCsv(rows = [], columns = []) {
  const header = columns.map((column) => escapeCell(column.label ?? column.key)).join(',');

  const body = rows.map((row) =>
    columns
      .map((column) => escapeCell(typeof column.value === 'function' ? column.value(row) : row[column.key]))
      .join(','),
  );

  // A trailing newline keeps `wc -l` and most parsers happy; the BOM makes Excel
  // on Windows read the file as UTF-8 instead of the system codepage, which is
  // what mangles accented patient and supplier names.
  return `\uFEFF${[header, ...body].join('\r\n')}\r\n`;
}

/** Send a CSV attachment. Filenames are sanitised — they end up in a header. */
export function sendCsv(res, { filename, rows, columns }) {
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '-');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  return res.status(200).send(toCsv(rows, columns));
}

export default toCsv;
