import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDicomFile } from '../../src/services/dicomReader.js';

function writeExplicitLe(tags) {
  const preamble = Buffer.alloc(128, 0);
  const dicm = Buffer.from('DICM', 'ascii');
  const chunks = [preamble, dicm];
  for (const { group, element, vr, value } of tags) {
    const payload = Buffer.from(value, 'latin1');
    const padded = payload.length % 2 === 1 ? Buffer.concat([payload, Buffer.from('\0')]) : payload;
    const header = Buffer.alloc(8);
    header.writeUInt16LE(group, 0);
    header.writeUInt16LE(element, 2);
    header.write(vr, 4, 2, 'ascii');
    header.writeUInt16LE(padded.length, 6);
    chunks.push(header, padded);
  }
  return Buffer.concat(chunks);
}

describe('parseDicomFile', () => {
  let dir;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-dicom-'));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads explicit VR little-endian tags after the DICM preamble', () => {
    const buf = writeExplicitLe([
      { group: 0x0008, element: 0x0018, vr: 'UI', value: '1.2.840.10008.1.1' },
      { group: 0x0008, element: 0x0060, vr: 'CS', value: 'CT' },
      { group: 0x0010, element: 0x0010, vr: 'PN', value: 'DOE^JANE' },
      { group: 0x0020, element: 0x000d, vr: 'UI', value: '1.2.3.4.5' },
    ]);
    const file = path.join(dir, 'sample.dcm');
    fs.writeFileSync(file, buf);
    const parsed = parseDicomFile(file);
    assert.equal(parsed.parsed, true);
    assert.equal(parsed.modality, 'CT');
    assert.equal(parsed.patientName, 'DOE^JANE');
    assert.equal(parsed.studyInstanceUid, '1.2.3.4.5');
    assert.equal(parsed.sopInstanceUid, '1.2.840.10008.1.1');
  });

  it('returns parsed:false when the preamble is missing', () => {
    const file = path.join(dir, 'not-dicom.bin');
    fs.writeFileSync(file, Buffer.from('JFIF not dicom'));
    const parsed = parseDicomFile(file);
    assert.equal(parsed.parsed, false);
  });
});
