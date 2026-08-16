import fs from 'node:fs';

/**
 * Explicit VR little-endian DICOM tag reader (the usual file from a modality
 * after the 128-byte preamble + "DICM").
 *
 * Implicit VR and big-endian files are stored but not parsed — the instance
 * is still retrievable; only the header fields are missing.
 */

const TAGS = {
  sopClassUid: [0x0008, 0x0016],
  sopInstanceUid: [0x0008, 0x0018],
  studyDate: [0x0008, 0x0020],
  accessionNumber: [0x0008, 0x0050],
  modality: [0x0008, 0x0060],
  studyDescription: [0x0008, 0x1030],
  patientName: [0x0010, 0x0010],
  patientId: [0x0010, 0x0020],
  studyInstanceUid: [0x0020, 0x000d],
  seriesInstanceUid: [0x0020, 0x000e],
  instanceNumber: [0x0020, 0x0013],
};

function readString(buf, offset, length) {
  return buf
    .subarray(offset, offset + length)
    .toString('latin1')
    .replace(/\0/g, '')
    .trim();
}

export function parseDicomFile(absolutePath) {
  const buf = fs.readFileSync(absolutePath);
  if (buf.length < 132 || buf.toString('ascii', 128, 132) !== 'DICM') {
    return { parsed: false, reason: 'Not an explicit DICOM file (missing DICM preamble)' };
  }

  const found = {};
  let offset = 132;
  const wanted = new Set(Object.keys(TAGS));

  while (offset + 8 <= buf.length && wanted.size) {
    const group = buf.readUInt16LE(offset);
    const element = buf.readUInt16LE(offset + 2);
    const vr = buf.toString('ascii', offset + 4, offset + 6);
    let length;
    let valueOffset;

    if (['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'].includes(vr)) {
      length = buf.readUInt32LE(offset + 8);
      valueOffset = offset + 12;
    } else {
      length = buf.readUInt16LE(offset + 6);
      valueOffset = offset + 8;
    }

    if (length === 0xffffffff || valueOffset + length > buf.length) break;

    for (const [name, [g, e]] of Object.entries(TAGS)) {
      if (group === g && element === e && wanted.has(name)) {
        found[name] = readString(buf, valueOffset, Math.min(length, 256));
        wanted.delete(name);
      }
    }

    // Pixel data — stop walking; we do not need the rest of the file.
    if (group === 0x7fe0 && element === 0x0010) break;
    offset = valueOffset + length;
    if (length % 2 === 1) offset += 1;
  }

  return { parsed: true, ...found };
}

export default parseDicomFile;
