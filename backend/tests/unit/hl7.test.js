import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOru } from '../../src/services/hl7Service.js';

const SAMPLE = [
  'MSH|^~\\&|ANALYZER|LAB|HMS|HOSP|202608151200||ORU^R01|MSG0001|P|2.3',
  'PID|||MRN-001||DOE^JANE',
  'OBR|1|LAB-000001|F-99|CBC^Complete Blood Count',
  'OBX|1|NM|HGB^Haemoglobin|1|13.2|g/dL|12-16|N',
  'OBX|2|NM|WBC^White cells|1|11.4|10^3/uL|4-10|H',
].join('\r');

describe('parseOru', () => {
  it('reads MSH, PID, OBR and OBX from an ORU^R01', () => {
    const parsed = parseOru(SAMPLE);
    assert.equal(parsed.messageControlId, 'MSG0001');
    assert.equal(parsed.patientMrn, 'MRN-001');
    assert.equal(parsed.placerOrderNumber, 'LAB-000001');
    assert.equal(parsed.testCode, 'CBC');
    assert.equal(parsed.observations.length, 2);
    assert.equal(parsed.observations[0].analyteCode, 'HGB');
    assert.equal(parsed.observations[0].value, '13.2');
    assert.equal(parsed.observations[1].abnormalFlags, 'H');
  });

  it('rejects a non-ORU message type', () => {
    assert.throws(
      () => parseOru('MSH|^~\\&|X|Y|A|B|2026||ADT^A01|1|P|2.3\rPID|||X'),
      /ORU/,
    );
  });

  it('rejects an empty payload', () => {
    assert.throws(() => parseOru(''), /Empty/);
  });
});
