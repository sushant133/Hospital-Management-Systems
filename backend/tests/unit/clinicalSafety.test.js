import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ControlledDrugRegister,
  Transfusion,
  DeathRecord,
  BirthRecord,
  IncidentReport,
  Problem,
  MedicoLegalCase,
  AntibioticApproval,
  DeviceDay,
} from '../../src/models/index.js';

const oid = (n) => `0000000000000000000000${String(n).padStart(2, '0')}`;

/**
 * Run a model's pre-save hooks without touching the database.
 * Resolves to the error, or null when the hooks pass.
 */
const runPreSave = (doc) =>
  new Promise((resolve) => doc.schema.s.hooks.execPre('save', doc, [], (err) => resolve(err || null)));

/**
 * A document as it exists after being LOADED from the database.
 *
 * `new Model(...)` marks every path modified, which is nothing like a loaded
 * document and would make any "did this field change?" hook fire on all of
 * them. `hydrate` is the faithful simulation, and it matters here because the
 * append-only rule is built on exactly that distinction.
 */
const asLoaded = (Model, attrs) => Model.hydrate(new Model(attrs).toObject());

/* ==========================================================================
 * B5 — CONTROLLED DRUG REGISTER
 * ======================================================================= */

test('narcotics: a movement cannot be witnessed by the person making it', () => {
  // A self-witnessed entry provides none of the protection the double signature
  // exists to give, and diversion is exactly what it exists to deter.
  const entry = new ControlledDrugRegister({
    wardId: oid(1), drugId: oid(2), drugName: 'Morphine 10mg', schedule: 'narcotic',
    entryType: 'administration', quantity: -1, balanceAfter: 9,
    performedBy: oid(3), witnessedBy: oid(3),
  });
  assert.ok(entry.validateSync()?.errors?.witnessedBy);
});

test('narcotics: wastage needs both a witness and a stated reason', () => {
  // Half an ampoule discarded is the commonest diversion route.
  const entry = new ControlledDrugRegister({
    wardId: oid(1), drugId: oid(2), drugName: 'Morphine', schedule: 'narcotic',
    entryType: 'wastage', quantity: -0.5, balanceAfter: 9, performedBy: oid(3),
  });
  const errors = entry.validateSync()?.errors;
  assert.ok(errors?.witnessedBy);
  assert.ok(errors?.reason);
});

test('narcotics: a plain receipt needs no witness', () => {
  const entry = new ControlledDrugRegister({
    wardId: oid(1), drugId: oid(2), drugName: 'Morphine', schedule: 'narcotic',
    entryType: 'receipt', quantity: 10, balanceAfter: 10, performedBy: oid(3),
  });
  assert.equal(entry.validateSync(), undefined);
});

test('narcotics: the register is append-only', async () => {
  // An alterable narcotic register is worthless as evidence.
  const entry = asLoaded(ControlledDrugRegister, {
    wardId: oid(1), drugId: oid(2), drugName: 'Morphine', schedule: 'narcotic',
    entryType: 'receipt', quantity: 10, balanceAfter: 10, performedBy: oid(3),
  });
  entry.quantity = 999;

  const error = await runPreSave(entry);
  assert.ok(error, 'editing a saved entry must be refused');
  assert.match(error.message, /append-only/);
});

test('narcotics: a discrepancy investigation may still be added later', async () => {
  // The one permitted after-the-fact addition: found now, explained afterwards.
  const entry = asLoaded(ControlledDrugRegister, {
    wardId: oid(1), drugId: oid(2), drugName: 'Morphine', schedule: 'narcotic',
    entryType: 'count-adjustment', quantity: -1, balanceAfter: 8,
    performedBy: oid(3), witnessedBy: oid(4), reason: 'Count short by one ampoule',
  });
  entry.discrepancy.investigated = true;
  entry.discrepancy.investigationNote = 'Traced to an unrecorded administration.';

  assert.equal(await runPreSave(entry), null);
});

/* ==========================================================================
 * B10 — TRANSFUSION
 * ======================================================================= */

const transfusionBase = {
  transfusionNumber: 'TXN-1', patientId: oid(1), encounterId: oid(2), bloodUnitId: oid(3),
  bagNumber: 'B1', component: 'prbc', unitBloodGroup: 'O+', patientBloodGroup: 'O+',
};

test('transfusion: cannot start before the bedside check is complete', async () => {
  // Nearly every fatal haemolytic reaction is the right unit in the wrong bed,
  // and the bedside check is the last barrier.
  const t = new Transfusion({ ...transfusionBase, status: 'in-progress' });
  const error = await runPreSave(t);
  assert.ok(error);
  assert.match(error.message, /unchecked at the bedside/);
});

test('transfusion: cannot start with only one person signing', async () => {
  const t = new Transfusion({
    ...transfusionBase,
    status: 'in-progress',
    checkedBy: oid(5),
    bedsideChecks: {
      patientIdentityConfirmed: true, unitLabelMatches: true, groupCompatible: true,
      expiryChecked: true, unitIntact: true, consentConfirmed: true,
    },
  });
  const error = await runPreSave(t);
  assert.ok(error);
  assert.match(error.message, /two named people/);
});

test('transfusion: the witness must be a second person', () => {
  const t = new Transfusion({ ...transfusionBase, checkedBy: oid(5), witnessedBy: oid(5) });
  assert.ok(t.validateSync()?.errors?.witnessedBy);
});

test('transfusion: starts once two people have completed every check', async () => {
  const t = new Transfusion({
    ...transfusionBase,
    status: 'in-progress',
    checkedBy: oid(5),
    witnessedBy: oid(6),
    bedsideChecks: {
      patientIdentityConfirmed: true, unitLabelMatches: true, groupCompatible: true,
      expiryChecked: true, unitIntact: true, consentConfirmed: true,
    },
  });
  assert.equal(await runPreSave(t), null);
});

/* ==========================================================================
 * B7 — DEATH AND BIRTH RECORDS
 * ======================================================================= */

const deathBase = {
  patientId: oid(1), diedAt: new Date('2026-03-01'), place: 'ward',
  pronouncedBy: oid(2), fiscalYear: '2082-83', deathRecordNumber: 'DTH-1',
};

test('MCCD: a mode of dying is refused as the underlying cause', () => {
  // Everyone dies of cardiac arrest; it explains nothing, and it is the
  // commonest error that makes national mortality data worthless.
  for (const mode of ['Cardiac arrest', 'Respiratory failure', 'Multi-organ failure']) {
    const record = new DeathRecord({ ...deathBase, causeChain: [{ line: 'Ia', condition: mode }] });
    assert.ok(record.validateSync()?.errors?.causeChain, `${mode} should be refused`);
  }
});

test('MCCD: a chain ending in a real condition is accepted', () => {
  const record = new DeathRecord({
    ...deathBase,
    causeChain: [
      { line: 'Ia', condition: 'Cardiac arrest' },
      { line: 'Ib', condition: 'Acute myocardial infarction' },
    ],
  });
  assert.equal(record.validateSync(), undefined);
});

test('MCCD: the underlying cause is the LAST line, not the first', async () => {
  const record = new DeathRecord({
    ...deathBase,
    causeChain: [
      { line: 'Ib', condition: 'Acute myocardial infarction' },
      { line: 'Ia', condition: 'Cardiac arrest' },
      { line: 'Ic', condition: 'Ischaemic heart disease' },
    ],
  });
  await runPreSave(record);
  // Lines arrive out of order; the chain is sorted before the last is taken.
  assert.equal(record.underlyingCauseText, 'Ischaemic heart disease');
});

test('death: an intra-operative death is flagged for review automatically', async () => {
  const record = new DeathRecord({ ...deathBase, place: 'theatre', causeChain: [{ line: 'Ia', condition: 'Haemorrhage' }] });
  await runPreSave(record);
  assert.equal(record.reviewRequired, true);
  assert.match(record.reviewReason, /Intra-operative/);
});

test('birth: low birth weight and preterm are derived, not retyped', () => {
  const record = new BirthRecord({
    birthRecordNumber: 'BTH-1', fiscalYear: '2082-83', motherPatientId: oid(1),
    bornAt: new Date(), outcome: 'live-birth', deliveryType: 'normal-vaginal',
    sex: 'female', birthWeightGrams: 2200, gestationWeeks: 35,
  });
  assert.equal(record.validateSync(), undefined);
  assert.equal(record.isLowBirthWeight, true);
  assert.equal(record.isPreterm, true);
});

/* ==========================================================================
 * B11 — GOVERNANCE
 * ======================================================================= */

test('incident: an anonymous report does not keep the reporter', async () => {
  // Storing the id while promising anonymity would be a lie the database keeps,
  // and the first time it was noticed reporting would stop.
  const report = new IncidentReport({
    incidentNumber: 'INC-1', category: 'medication-error', harmLevel: 'near-miss',
    occurredAt: new Date(), description: 'Wrong strength drawn up, caught before administration.',
    isAnonymous: true, reportedBy: oid(9),
  });
  await runPreSave(report);
  assert.equal(report.reportedBy, null);
});

test('incident: near-miss and no-harm are first-class harm levels', () => {
  // The commonest and most instructive reports carry no injury at all.
  for (const harmLevel of ['near-miss', 'no-harm']) {
    const report = new IncidentReport({
      incidentNumber: 'INC-2', category: 'near-miss', harmLevel,
      occurredAt: new Date(), description: 'x',
    });
    assert.equal(report.validateSync(), undefined);
  }
});

test('incident: overdue actions are surfaced', () => {
  const report = new IncidentReport({
    incidentNumber: 'INC-3', category: 'patient-fall', harmLevel: 'minor',
    occurredAt: new Date(), description: 'x',
    actions: [
      { description: 'Review bed rails', dueDate: new Date('2020-01-01') },
      { description: 'Done already', dueDate: new Date('2020-01-01'), completedAt: new Date() },
    ],
  });
  assert.equal(report.overdueActions.length, 1);
});

/* ==========================================================================
 * B8 / B6 / B9
 * ======================================================================= */

test('problem: resolving one requires the date it resolved', () => {
  const problem = new Problem({ patientId: oid(1), display: 'Pulmonary tuberculosis', status: 'resolved' });
  assert.ok(problem.validateSync()?.errors?.resolvedDate);

  problem.resolvedDate = new Date();
  assert.equal(problem.validateSync(), undefined);
});

test('problem: entered-in-error needs a reason', () => {
  const problem = new Problem({ patientId: oid(1), display: 'Diabetes', status: 'entered-in-error' });
  assert.ok(problem.validateSync()?.errors?.erroneousReason);
});

test('MLC: police intimation is overdue after six hours', () => {
  const stale = new MedicoLegalCase({
    mlcNumber: 'MLC-1', fiscalYear: '2082-83', patientId: oid(1), encounterId: oid(2),
    category: 'assault', arrivedAt: new Date(Date.now() - 8 * 3600000),
  });
  assert.equal(stale.policeIntimationOverdue, true);

  stale.policeInformedAt = new Date();
  assert.equal(stale.policeIntimationOverdue, false);
});

test('device days: the denominator counts at least one day', () => {
  // A line in and out the same day is one device-day, not zero — a zero
  // denominator makes the infection rate infinite.
  const device = new DeviceDay({
    patientId: oid(1), encounterId: oid(2), deviceType: 'central-line',
    insertedAt: new Date('2026-03-01T08:00:00Z'), removedAt: new Date('2026-03-01T18:00:00Z'),
  });
  assert.equal(device.deviceDays, 1);
});

test('stewardship: an approval expires rather than standing open', async () => {
  const approval = new AntibioticApproval({
    patientId: oid(1), encounterId: oid(2), drugId: oid(3), drugName: 'Meropenem',
    tier: 'reserve', indication: 'Septic shock', requestedBy: oid(4),
    status: 'approved', approvedDays: 3,
  });
  await runPreSave(approval);
  assert.ok(approval.expiresAt, 'an approved course must carry an expiry');
  const days = Math.round((approval.expiresAt - Date.now()) / 86400000);
  assert.equal(days, 3);
});
