import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import config from '../config/index.js';
import { flagLabel } from './labResult.service.js';

/**
 * Lab report PDF generation.
 *
 * Files land in  <uploads>/lab-reports/<patientId>/<orderNumber>-<timestamp>.pdf
 * and are served ONLY through the authenticated download route — the uploads
 * directory is deliberately not mounted with express.static, because these are
 * patient records.
 */

const COLORS = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#cbd5e1',
  brand: '#1d4ed8',
  danger: '#b91c1c',
  warn: '#b45309',
};

const PAGE_MARGIN = 48;

/** Absolute path to the uploads root. */
export function uploadsRoot() {
  return config.uploadsDir;
}

/** Absolute path for a stored relative report path, guarded against traversal. */
export function resolveUploadPath(relativePath) {
  const root = path.resolve(uploadsRoot());
  const resolved = path.resolve(root, relativePath);

  // A stored path should never escape the uploads root; refuse if it does.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Resolved upload path escapes the uploads directory');
  }
  return resolved;
}

function formatDate(value, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const datePart = date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  if (!withTime) return datePart;
  const timePart = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} ${timePart}`;
}

function ageFrom(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) years -= 1;
  return years >= 0 ? years : null;
}

function personName(person) {
  if (!person) return '—';
  return [person.firstName, person.lastName].filter(Boolean).join(' ') || '—';
}

// ---------------------------------------------------------------- layout ----

function drawLetterhead(doc) {
  const { hospital } = config;

  doc
    .fillColor(COLORS.brand)
    .fontSize(20)
    .font('Helvetica-Bold')
    .text(hospital.name, PAGE_MARGIN, PAGE_MARGIN);

  doc
    .fillColor(COLORS.muted)
    .fontSize(9)
    .font('Helvetica')
    .text(hospital.address, { width: 340 });

  if (hospital.phone || hospital.email) {
    doc.text([hospital.phone, hospital.email].filter(Boolean).join('  ·  '), { width: 340 });
  }

  // Right-aligned document title.
  doc
    .fillColor(COLORS.ink)
    .fontSize(13)
    .font('Helvetica-Bold')
    .text('LABORATORY REPORT', PAGE_MARGIN, PAGE_MARGIN + 6, {
      align: 'right',
      width: doc.page.width - PAGE_MARGIN * 2,
    });

  doc
    .fillColor(COLORS.muted)
    .fontSize(8)
    .font('Helvetica')
    .text('Department of Pathology & Laboratory Medicine', {
      align: 'right',
      width: doc.page.width - PAGE_MARGIN * 2,
    });

  const y = Math.max(doc.y, PAGE_MARGIN + 58) + 8;
  doc.moveTo(PAGE_MARGIN, y).lineTo(doc.page.width - PAGE_MARGIN, y).lineWidth(1.5)
    .strokeColor(COLORS.brand).stroke();
  doc.y = y + 14;
}

/** Two-column patient / order identification block. */
function drawPatientBlock(doc, { patient, order, encounter }) {
  const top = doc.y;
  const colWidth = (doc.page.width - PAGE_MARGIN * 2) / 2;
  const age = ageFrom(patient?.dateOfBirth);

  const left = [
    ['Patient', personName(patient)],
    ['MRN', patient?.mrn ?? '—'],
    ['Age / Sex', `${age !== null ? `${age} yrs` : '—'} / ${patient?.gender ?? '—'}`],
    ['Date of birth', formatDate(patient?.dateOfBirth, false)],
  ];

  const right = [
    ['Order no.', order?.orderNumber ?? '—'],
    ['Visit no.', encounter?.encounterNumber ?? '—'],
    ['Ordered by', personName(order?.orderedBy)],
    ['Collected', formatDate(order?.collectedAt)],
  ];

  const drawColumn = (rows, x) => {
    let y = top;
    for (const [label, value] of rows) {
      doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica').text(label.toUpperCase(), x, y);
      doc.fillColor(COLORS.ink).fontSize(10).font('Helvetica-Bold')
        .text(String(value), x, y + 10, { width: colWidth - 16 });
      y += 30;
    }
    return y;
  };

  const leftEnd = drawColumn(left, PAGE_MARGIN);
  const rightEnd = drawColumn(right, PAGE_MARGIN + colWidth);

  doc.y = Math.max(leftEnd, rightEnd) + 4;

  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(doc.page.width - PAGE_MARGIN, doc.y)
    .lineWidth(0.5).strokeColor(COLORS.line).stroke();
  doc.y += 14;
}

/**
 * Widths total the A4 content width (595.28 - 2*48 ≈ 499pt).
 * The flag column must fit 'CRITICAL HIGH' at 9pt bold on ONE line — if it
 * wraps, the second line overlaps the row beneath it.
 */
const TABLE_COLUMNS = [
  { key: 'analyte', label: 'Test / Analyte', width: 165 },
  { key: 'value', label: 'Result', width: 80 },
  { key: 'unit', label: 'Unit', width: 58 },
  { key: 'range', label: 'Reference range', width: 100 },
  { key: 'flag', label: 'Flag', width: 96 },
];

function drawTableHeader(doc) {
  const y = doc.y;
  doc.rect(PAGE_MARGIN, y - 3, doc.page.width - PAGE_MARGIN * 2, 18)
    .fillColor('#f1f5f9').fill();

  let x = PAGE_MARGIN + 4;
  doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica-Bold');
  for (const column of TABLE_COLUMNS) {
    doc.text(column.label.toUpperCase(), x, y + 2, { width: column.width - 6 });
    x += column.width;
  }
  doc.y = y + 20;
}

/** Start a new page mid-table, repeating the header. */
function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - 120) {
    doc.addPage();
    doc.y = PAGE_MARGIN;
    drawTableHeader(doc);
  }
}

function drawResultRow(doc, value) {
  ensureSpace(doc, 22);

  const y = doc.y;
  const isAbnormal = value.flag && value.flag !== 'normal';
  const isCritical = value.flag === 'critical-low' || value.flag === 'critical-high';
  const valueColor = isCritical ? COLORS.danger : isAbnormal ? COLORS.warn : COLORS.ink;

  const cells = [
    { text: value.analyteName, color: COLORS.ink, font: 'Helvetica' },
    { text: value.value, color: valueColor, font: isAbnormal ? 'Helvetica-Bold' : 'Helvetica' },
    { text: value.unit || '—', color: COLORS.muted, font: 'Helvetica' },
    { text: value.referenceRange || '—', color: COLORS.muted, font: 'Helvetica' },
    { text: flagLabel(value.flag), color: valueColor, font: 'Helvetica-Bold' },
  ];

  let x = PAGE_MARGIN + 4;
  doc.fontSize(9);
  cells.forEach((cell, index) => {
    // lineBreak:false is load-bearing — a wrapped cell would spill onto the
    // row below and overlap it. Overlong values are ellipsized instead.
    doc.fillColor(cell.color).font(cell.font).text(cell.text, x, y, {
      width: TABLE_COLUMNS[index].width - 6,
      lineBreak: false,
      ellipsis: true,
    });
    x += TABLE_COLUMNS[index].width;
  });

  doc.y = y + 15;

  if (value.notes) {
    doc.fillColor(COLORS.muted).fontSize(7.5).font('Helvetica-Oblique')
      .text(value.notes, PAGE_MARGIN + 10, doc.y, { width: 400 });
    doc.y += 11;
  }

  doc.moveTo(PAGE_MARGIN, doc.y - 2).lineTo(doc.page.width - PAGE_MARGIN, doc.y - 2)
    .lineWidth(0.25).strokeColor(COLORS.line).stroke();
}

function drawTestSection(doc, result) {
  ensureSpace(doc, 46);

  doc.fillColor(COLORS.brand).fontSize(10.5).font('Helvetica-Bold')
    .text(`${result.testName}  (${result.testCode})`, PAGE_MARGIN, doc.y);
  doc.y += 4;

  drawTableHeader(doc);
  for (const value of result.values ?? []) drawResultRow(doc, value);

  if (result.technicianNotes || result.interpretation) {
    ensureSpace(doc, 40);
    doc.y += 6;
    if (result.interpretation) {
      doc.fillColor(COLORS.ink).fontSize(8.5).font('Helvetica-Bold')
        .text('Interpretation: ', PAGE_MARGIN, doc.y, { continued: true })
        .font('Helvetica').fillColor(COLORS.muted).text(result.interpretation);
      doc.y += 4;
    }
    if (result.technicianNotes) {
      doc.fillColor(COLORS.ink).fontSize(8.5).font('Helvetica-Bold')
        .text('Notes: ', PAGE_MARGIN, doc.y, { continued: true })
        .font('Helvetica').fillColor(COLORS.muted).text(result.technicianNotes);
      doc.y += 4;
    }
  }

  doc.y += 12;
}

function drawCriticalBanner(doc, results) {
  const hasCritical = results.some((r) => r.hasCriticalValues);
  if (!hasCritical) return;

  const height = 26;
  doc.rect(PAGE_MARGIN, doc.y, doc.page.width - PAGE_MARGIN * 2, height)
    .fillColor('#fef2f2').fill();
  doc.rect(PAGE_MARGIN, doc.y, 3, height).fillColor(COLORS.danger).fill();

  doc.fillColor(COLORS.danger).fontSize(9).font('Helvetica-Bold')
    .text('CRITICAL VALUES PRESENT — requires immediate clinical attention',
      PAGE_MARGIN + 12, doc.y + 9);

  doc.y += height + 12;
}

function drawSignatures(doc, { performedBy, verifiedBy }) {
  // Keep the signature block on one page with a bit of room to breathe.
  if (doc.y > doc.page.height - 150) {
    doc.addPage();
    doc.y = PAGE_MARGIN;
  }

  doc.y = Math.max(doc.y + 16, doc.page.height - 150);

  const colWidth = (doc.page.width - PAGE_MARGIN * 2) / 2;
  const y = doc.y;

  const block = (x, title, person, credential) => {
    doc.moveTo(x, y + 34).lineTo(x + colWidth - 40, y + 34)
      .lineWidth(0.75).strokeColor(COLORS.ink).stroke();

    doc.fillColor(COLORS.ink).fontSize(9).font('Helvetica-Bold')
      .text(personName(person), x, y + 40, { width: colWidth - 40 });
    doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica')
      .text(title, x, y + 52, { width: colWidth - 40 });
    if (credential) {
      doc.fontSize(7.5).text(credential, x, y + 62, { width: colWidth - 40 });
    }
  };

  block(PAGE_MARGIN, 'Performed / Verified by (Lab Technician)', verifiedBy ?? performedBy,
    verifiedBy?.licenseNumber ? `Licence: ${verifiedBy.licenseNumber}` : '');

  // Left blank for wet signature — a pathologist sign-off is a clinical
  // attestation and is not auto-filled from the ordering record.
  block(PAGE_MARGIN + colWidth, 'Pathologist (signature)', { firstName: '', lastName: '' }, '');

  doc.y = y + 78;
}

function drawFooter(doc, order) {
  const range = doc.bufferedPageRange();

  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const y = doc.page.height - 42;

    doc.moveTo(PAGE_MARGIN, y).lineTo(doc.page.width - PAGE_MARGIN, y)
      .lineWidth(0.5).strokeColor(COLORS.line).stroke();

    doc.fillColor(COLORS.muted).fontSize(7).font('Helvetica')
      .text(
        `${order.orderNumber} · Generated ${formatDate(new Date())} · This report is electronically generated and valid without a stamp.`,
        PAGE_MARGIN, y + 6, { width: doc.page.width - PAGE_MARGIN * 2 - 60 },
      );

    doc.text(`Page ${i - range.start + 1} of ${range.count}`,
      doc.page.width - PAGE_MARGIN - 60, y + 6, { width: 60, align: 'right' });
  }
}

// ------------------------------------------------------------ generation ----

/**
 * Render the report and write it to disk.
 *
 * @returns {Promise<{ relativePath: string, absolutePath: string, bytes: number }>}
 */
export async function generateLabReport({ order, patient, encounter, results }) {
  const patientDir = path.join(uploadsRoot(), 'lab-reports', String(patient._id));
  await fs.promises.mkdir(patientDir, { recursive: true });

  const fileName = `${order.orderNumber}-${Date.now()}.pdf`;
  const absolutePath = path.join(patientDir, fileName);
  const relativePath = path.posix.join('lab-reports', String(patient._id), fileName);

  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    bufferPages: true, // needed so the footer can number pages after layout
    info: {
      Title: `Lab Report ${order.orderNumber}`,
      Author: config.hospital.name,
      Subject: `Laboratory report for ${personName(patient)} (${patient.mrn})`,
    },
  });

  const stream = fs.createWriteStream(absolutePath);
  doc.pipe(stream);

  drawLetterhead(doc);
  drawPatientBlock(doc, { patient, order, encounter });
  drawCriticalBanner(doc, results);

  for (const result of results) drawTestSection(doc, result);

  const verifier = results.find((r) => r.verifiedBy)?.verifiedBy;
  const performer = results.find((r) => r.performedBy)?.performedBy;
  drawSignatures(doc, { performedBy: performer, verifiedBy: verifier });

  drawFooter(doc, order);

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  const { size } = await fs.promises.stat(absolutePath);
  return { relativePath, absolutePath, bytes: size };
}

export default generateLabReport;
