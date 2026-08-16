/**
 * Minimal HL7 v2 ORU^R01 parser.
 *
 * Enough to accept an analyzer (or a middleware box) posting a result message
 * and turn it into the same shape the result-entry form uses. Not a full
 * pipe-and-hat library — encodings, repeating fields and Z-segments that we
 * do not need are ignored.
 */

function fields(segment) {
  return segment.split('|');
}

function component(field = '', index = 0) {
  return (field.split('^')[index] ?? '').trim();
}

export function parseOru(raw) {
  const text = String(raw ?? '').replace(/\r\n/g, '\r').replace(/\n/g, '\r');
  const segments = text.split('\r').map((s) => s.trim()).filter(Boolean);
  if (!segments.length) throw new Error('Empty HL7 message');

  const msh = segments.find((s) => s.startsWith('MSH'));
  if (!msh) throw new Error('Missing MSH segment');

  const pid = segments.find((s) => s.startsWith('PID'));
  const obr = segments.find((s) => s.startsWith('OBR'));
  const obx = segments.filter((s) => s.startsWith('OBX'));

  const pidFields = pid ? fields(pid) : [];
  const obrFields = obr ? fields(obr) : [];

  const messageType = component(fields(msh)[8] || '', 0);
  if (messageType && !messageType.startsWith('ORU')) {
    throw new Error(`Unsupported message type ${messageType} — expected ORU^R01`);
  }

  return {
    messageControlId: fields(msh)[9] || '',
    sendingApplication: fields(msh)[2] || '',
    patientMrn: component(pidFields[3] || '', 0) || pidFields[3] || '',
    patientName: [component(pidFields[5] || '', 1), component(pidFields[5] || '', 0)]
      .filter(Boolean)
      .join(' '),
    placerOrderNumber: component(obrFields[2] || '', 0),
    fillerOrderNumber: component(obrFields[3] || '', 0),
    testCode: component(obrFields[4] || '', 0),
    testName: component(obrFields[4] || '', 1),
    observations: obx.map((seg) => {
      const f = fields(seg);
      return {
        analyteCode: component(f[3] || '', 0),
        analyteName: component(f[3] || '', 1) || component(f[3] || '', 0),
        valueType: f[2] || 'ST',
        value: (f[5] || '').trim(),
        unit: component(f[6] || '', 0),
        referenceRange: f[7] || '',
        abnormalFlags: (f[8] || '').trim(),
      };
    }),
  };
}

export default parseOru;
