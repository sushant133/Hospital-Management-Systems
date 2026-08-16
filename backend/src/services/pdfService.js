import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import config from '../config/env.js';
import { flagLabel } from './labService.js';

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

// -------------------------------------------------------- radiology PDF ----

function drawRadiologyLetterhead(doc) {
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

  doc
    .fillColor(COLORS.ink)
    .fontSize(13)
    .font('Helvetica-Bold')
    .text('RADIOLOGY REPORT', PAGE_MARGIN, PAGE_MARGIN + 6, {
      align: 'right',
      width: doc.page.width - PAGE_MARGIN * 2,
    });

  doc
    .fillColor(COLORS.muted)
    .fontSize(8)
    .font('Helvetica')
    .text('Department of Diagnostic Imaging', {
      align: 'right',
      width: doc.page.width - PAGE_MARGIN * 2,
    });

  const y = Math.max(doc.y, PAGE_MARGIN + 58) + 8;
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .lineWidth(1.5)
    .strokeColor(COLORS.brand)
    .stroke();
  doc.y = y + 14;
}

function drawRadiologyPatientBlock(doc, { patient, order, encounter }) {
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
    ['Exam', `${order?.name ?? '—'} (${order?.code ?? '—'})`],
  ];

  const drawColumn = (rows, x) => {
    let y = top;
    for (const [label, value] of rows) {
      doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica').text(label.toUpperCase(), x, y);
      doc
        .fillColor(COLORS.ink)
        .fontSize(10)
        .font('Helvetica-Bold')
        .text(String(value), x, y + 10, { width: colWidth - 16 });
      y += 30;
    }
    return y;
  };

  const leftEnd = drawColumn(left, PAGE_MARGIN);
  const rightEnd = drawColumn(right, PAGE_MARGIN + colWidth);

  doc.y = Math.max(leftEnd, rightEnd) + 4;
  doc
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(doc.page.width - PAGE_MARGIN, doc.y)
    .lineWidth(0.5)
    .strokeColor(COLORS.line)
    .stroke();
  doc.y += 14;
}

function drawNarrativeSection(doc, heading, body) {
  if (!body) return;
  const width = doc.page.width - PAGE_MARGIN * 2;
  if (doc.y + 48 > doc.page.height - 120) {
    doc.addPage();
    doc.y = PAGE_MARGIN;
  }
  doc.fillColor(COLORS.brand).fontSize(10).font('Helvetica-Bold').text(heading.toUpperCase(), PAGE_MARGIN, doc.y);
  doc.y += 4;
  doc
    .fillColor(COLORS.ink)
    .fontSize(10)
    .font('Helvetica')
    .text(body, PAGE_MARGIN, doc.y, { width, align: 'justify' });
  doc.y += 12;
}

function drawRadiologyCriticalBanner(doc, result) {
  if (!result?.isCritical) return;
  const height = 32;
  doc.rect(PAGE_MARGIN, doc.y, doc.page.width - PAGE_MARGIN * 2, height).fillColor('#fef2f2').fill();
  doc.rect(PAGE_MARGIN, doc.y, 3, height).fillColor(COLORS.danger).fill();
  doc
    .fillColor(COLORS.danger)
    .fontSize(9)
    .font('Helvetica-Bold')
    .text('CRITICAL FINDING — requires immediate clinical attention', PAGE_MARGIN + 12, doc.y + 6);
  if (result.criticalNote) {
    doc
      .fillColor(COLORS.danger)
      .fontSize(8)
      .font('Helvetica')
      .text(result.criticalNote, PAGE_MARGIN + 12, doc.y + 18, {
        width: doc.page.width - PAGE_MARGIN * 2 - 20,
        lineBreak: false,
        ellipsis: true,
      });
  }
  doc.y += height + 12;
}

function drawRadiologySignatures(doc, result) {
  if (doc.y > doc.page.height - 150) {
    doc.addPage();
    doc.y = PAGE_MARGIN;
  }
  doc.y = Math.max(doc.y + 16, doc.page.height - 150);

  const colWidth = (doc.page.width - PAGE_MARGIN * 2) / 2;
  const y = doc.y;
  const person = result?.verifiedBy ?? result?.reportedBy;

  doc
    .moveTo(PAGE_MARGIN, y + 34)
    .lineTo(PAGE_MARGIN + colWidth - 40, y + 34)
    .lineWidth(0.75)
    .strokeColor(COLORS.ink)
    .stroke();
  doc
    .fillColor(COLORS.ink)
    .fontSize(9)
    .font('Helvetica-Bold')
    .text(personName(person), PAGE_MARGIN, y + 40, { width: colWidth - 40 });
  doc
    .fillColor(COLORS.muted)
    .fontSize(8)
    .font('Helvetica')
    .text('Reporting radiologist', PAGE_MARGIN, y + 52, { width: colWidth - 40 });
  if (person?.licenseNumber) {
    doc.fontSize(7.5).text(`Licence: ${person.licenseNumber}`, PAGE_MARGIN, y + 62, {
      width: colWidth - 40,
    });
  }

  doc.y = y + 78;
}

/**
 * Render the imaging report and write it to disk.
 *
 * Files land in <uploads>/radiology-reports/<patientId>/<orderNumber>-<ts>.pdf
 * and are served only through the authenticated download route.
 */
export async function generateRadiologyReport({ order, patient, encounter, result }) {
  const patientDir = path.join(uploadsRoot(), 'radiology-reports', String(patient._id));
  await fs.promises.mkdir(patientDir, { recursive: true });

  const fileName = `${order.orderNumber}-${Date.now()}.pdf`;
  const absolutePath = path.join(patientDir, fileName);
  const relativePath = path.posix.join('radiology-reports', String(patient._id), fileName);

  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    bufferPages: true,
    info: {
      Title: `Radiology Report ${order.orderNumber}`,
      Author: config.hospital.name,
      Subject: `Imaging report for ${personName(patient)} (${patient.mrn})`,
    },
  });

  const stream = fs.createWriteStream(absolutePath);
  doc.pipe(stream);

  drawRadiologyLetterhead(doc);
  drawRadiologyPatientBlock(doc, { patient, order, encounter });
  drawRadiologyCriticalBanner(doc, result);

  const meta = [
    ['Modality', String(order.modality ?? '—').toUpperCase()],
    ['Body part', order.bodyPart ?? '—'],
    ['Priority', order.priority ?? '—'],
    ['Indication', order.clinicalIndication ?? '—'],
    ['Technique', result?.technique || '—'],
    ['Contrast', order.contrastRequired ? 'Required' : 'Not required'],
  ];
  for (const [label, value] of meta) {
    doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica').text(label.toUpperCase(), PAGE_MARGIN, doc.y);
    doc
      .fillColor(COLORS.ink)
      .fontSize(10)
      .font('Helvetica')
      .text(String(value), PAGE_MARGIN, doc.y + 10, { width: doc.page.width - PAGE_MARGIN * 2 });
    doc.y += 28;
  }

  doc
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(doc.page.width - PAGE_MARGIN, doc.y)
    .lineWidth(0.5)
    .strokeColor(COLORS.line)
    .stroke();
  doc.y += 14;

  drawNarrativeSection(doc, 'Findings', result?.findings);
  drawNarrativeSection(doc, 'Impression', result?.impression);
  drawNarrativeSection(doc, 'Recommendation', result?.recommendation);

  const attachments = result?.attachments ?? [];
  if (attachments.length) {
    drawNarrativeSection(
      doc,
      'Attached images',
      attachments.map((a, i) => `${i + 1}. ${a.filename}`).join('\n'),
    );
  }

  if (result?.status === 'amended' && result.amendmentReason) {
    drawNarrativeSection(doc, 'Amendment', result.amendmentReason);
  }

  drawRadiologySignatures(doc, result);
  drawFooter(doc, order);

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  const { size } = await fs.promises.stat(absolutePath);
  return { relativePath, absolutePath, bytes: size };
}


// --------------------------------------------------------------- receipts ----

const money = (value) => Number(value ?? 0).toFixed(2);

/**
 * Render an invoice and its payments as a receipt.
 *
 * Returns a **Buffer** rather than writing to disk, unlike the lab and
 * radiology reports. Those are clinical records that must be reproducible
 * years later; a receipt is a rendering of an invoice that can still move
 * until the bill is settled, so it is generated on demand and never becomes a
 * stale second copy of the truth.
 */
export async function generateReceipt({ invoice, patient, encounter, lines = [], payments = [] }) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    bufferPages: true,
    info: {
      Title: `Receipt ${invoice.invoiceNumber}`,
      Author: config.hospital.name,
      Subject: `Invoice ${invoice.invoiceNumber} for ${personName(patient)}`,
    },
  });

  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  drawLetterhead(doc);

  // --- Title ---
  doc.fillColor(COLORS.ink).fontSize(16).font('Helvetica-Bold')
    .text(invoice.status === 'paid' ? 'RECEIPT' : 'INVOICE', PAGE_MARGIN, doc.y);
  doc.moveDown(0.5);

  // --- Patient / invoice block ---
  const top = doc.y;
  const colWidth = (doc.page.width - PAGE_MARGIN * 2) / 2;

  const left = [
    ['Patient', personName(patient)],
    ['MRN', patient?.mrn ?? '—'],
    ['Visit no.', encounter?.encounterNumber ?? '—'],
  ];
  const right = [
    ['Invoice no.', invoice.invoiceNumber],
    ['Issued', formatDate(invoice.issuedAt)],
    ['Status', String(invoice.status).toUpperCase()],
  ];

  const drawColumn = (rows, x) => {
    let y = top;
    for (const [label, value] of rows) {
      doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica').text(label.toUpperCase(), x, y);
      doc.fillColor(COLORS.ink).fontSize(10).font('Helvetica-Bold')
        .text(String(value), x, y + 10, { width: colWidth - 16 });
      y += 28;
    }
    return y;
  };

  const leftEnd = drawColumn(left, PAGE_MARGIN);
  const rightEnd = drawColumn(right, PAGE_MARGIN + colWidth);
  doc.y = Math.max(leftEnd, rightEnd) + 4;

  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(doc.page.width - PAGE_MARGIN, doc.y)
    .lineWidth(0.5).strokeColor(COLORS.line).stroke();
  doc.y += 14;

  // --- Charges ---
  const COLS = { desc: 250, qty: 50, unit: 90, total: 90 };
  let y = doc.y;

  doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica-Bold');
  doc.text('DESCRIPTION', PAGE_MARGIN, y);
  doc.text('QTY', PAGE_MARGIN + COLS.desc, y, { width: COLS.qty, align: 'right' });
  doc.text('UNIT', PAGE_MARGIN + COLS.desc + COLS.qty, y, { width: COLS.unit, align: 'right' });
  doc.text('AMOUNT', PAGE_MARGIN + COLS.desc + COLS.qty + COLS.unit, y, { width: COLS.total, align: 'right' });
  y += 14;

  doc.moveTo(PAGE_MARGIN, y).lineTo(doc.page.width - PAGE_MARGIN, y)
    .lineWidth(0.5).strokeColor(COLORS.line).stroke();
  y += 6;

  for (const line of lines) {
    if (y > doc.page.height - 180) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    const cancelled = line.status === 'cancelled';
    doc.fillColor(cancelled ? COLORS.muted : COLORS.ink).fontSize(9).font('Helvetica');
    doc.text(`${line.description}${cancelled ? ' (cancelled)' : ''}`, PAGE_MARGIN, y, { width: COLS.desc - 8 });
    doc.text(String(line.quantity ?? 1), PAGE_MARGIN + COLS.desc, y, { width: COLS.qty, align: 'right' });
    doc.text(money(line.unitPrice), PAGE_MARGIN + COLS.desc + COLS.qty, y, { width: COLS.unit, align: 'right' });
    doc.text(money(line.lineTotal), PAGE_MARGIN + COLS.desc + COLS.qty + COLS.unit, y, { width: COLS.total, align: 'right' });
    y += 16;
  }

  y += 6;
  doc.moveTo(PAGE_MARGIN, y).lineTo(doc.page.width - PAGE_MARGIN, y)
    .lineWidth(0.5).strokeColor(COLORS.line).stroke();
  y += 10;

  // --- Totals ---
  const totalsX = PAGE_MARGIN + COLS.desc;
  const totalsWidth = COLS.qty + COLS.unit;
  const amountX = PAGE_MARGIN + COLS.desc + COLS.qty + COLS.unit;

  const row = (label, value, bold = false) => {
    doc.fillColor(bold ? COLORS.ink : COLORS.muted)
      .fontSize(bold ? 11 : 9)
      .font(bold ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(label, totalsX, y, { width: totalsWidth, align: 'right' });
    doc.text(money(value), amountX, y, { width: COLS.total, align: 'right' });
    y += bold ? 18 : 14;
  };

  row('Subtotal', invoice.subtotal);
  if (invoice.discountAmount > 0) row('Discount', -invoice.discountAmount);
  if (invoice.taxAmount > 0) row(`Tax (${invoice.taxPercent}%)`, invoice.taxAmount);
  row('Total', invoice.total, true);
  if (invoice.insuranceCoveredAmount > 0) {
    row('Covered by insurer', -invoice.insuranceCoveredAmount);
    row('Payable by patient', invoice.patientResponsibleAmount, true);
  }

  // --- Payments ---
  if (payments.length) {
    y += 8;
    doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica-Bold')
      .text('PAYMENTS', PAGE_MARGIN, y);
    y += 14;

    for (const payment of payments) {
      doc.fillColor(COLORS.ink).fontSize(9).font('Helvetica');
      const label = `${formatDate(payment.receivedAt, false)} · ${payment.method}${
        payment.reference ? ` · ${payment.reference}` : ''
      }${payment.type !== 'payment' ? ` · ${payment.type}` : ''}`;
      doc.text(label, PAGE_MARGIN, y, { width: COLS.desc + COLS.qty });
      doc.text(money(payment.amount), amountX, y, { width: COLS.total, align: 'right' });
      y += 14;
    }
  }

  y += 6;
  doc.moveTo(totalsX, y).lineTo(doc.page.width - PAGE_MARGIN, y)
    .lineWidth(1).strokeColor(COLORS.ink).stroke();
  y += 8;

  doc.fillColor(invoice.balance > 0 ? COLORS.danger : COLORS.ink).fontSize(12).font('Helvetica-Bold');
  doc.text(invoice.balance > 0 ? 'BALANCE DUE' : 'PAID IN FULL', totalsX, y, {
    width: totalsWidth,
    align: 'right',
  });
  doc.text(money(invoice.balance), amountX, y, { width: COLS.total, align: 'right' });

  // --- Footer ---
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const footerY = doc.page.height - 42;
    doc.moveTo(PAGE_MARGIN, footerY).lineTo(doc.page.width - PAGE_MARGIN, footerY)
      .lineWidth(0.5).strokeColor(COLORS.line).stroke();
    doc.fillColor(COLORS.muted).fontSize(7).font('Helvetica')
      .text(
        `${invoice.invoiceNumber} · Generated ${formatDate(new Date())} · This document is electronically generated and valid without a stamp.`,
        PAGE_MARGIN, footerY + 6, { width: doc.page.width - PAGE_MARGIN * 2 - 60 },
      );
    doc.text(`Page ${i - range.start + 1} of ${range.count}`,
      doc.page.width - PAGE_MARGIN - 60, footerY + 6, { width: 60, align: 'right' });
  }

  doc.end();
  await finished;

  return Buffer.concat(chunks);
}
