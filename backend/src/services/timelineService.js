import {
  Encounter,
  ClinicalNote,
  VitalSigns,
  LabOrder,
  LabResult,
  Appointment,
  RadiologyOrder,
  RadiologyResult,
  Prescription,
  Dispense,
} from '../models/index.js';
import { can, MODULES } from '../config/permissions.js';

/**
 * The unified patient timeline: everything that happened to one patient, from
 * every module, in one chronological list.
 *
 * Two rules govern this file.
 *
 * 1. **It reads, it never writes.** Each source is queried with a lean
 *    projection and mapped to a common event shape.
 *
 * 2. **It is permission-filtered per source, not gated as a whole.** A
 *    receptionist may see that a visit happened without seeing the clinical
 *    note written during it. Rather than one coarse gate, each source is
 *    included only if the caller holds the grant that module's own routes
 *    require — so the timeline can never become a way around them.
 *
 * Later phases add their sources here: prescriptions and dispenses, invoices
 * and payments.
 */

/** The common shape every source is mapped into. */
function event({ type, date, title, summary, icon, resourceId, encounterId, meta }) {
  return { type, date, title, summary, icon, resourceId, encounterId, meta: meta ?? {} };
}

const name = (person) =>
  person ? [person.firstName, person.lastName].filter(Boolean).join(' ') : null;

export async function buildPatientTimeline({ patientId, user, from, to, limit = 200, types }) {
  const dateFilter = {};
  if (from) dateFilter.$gte = from;
  if (to) dateFilter.$lte = to;
  const hasRange = Object.keys(dateFilter).length > 0;

  const wanted = (type) => !types?.length || types.includes(type);
  const allowed = (module, action) => can(user.role, module, action);

  const sources = [];

  // --- Visits ---
  if (wanted('encounter') && allowed(MODULES.ENCOUNTERS, 'view')) {
    sources.push(
      Encounter.find({
        patientId,
        isActive: true,
        ...(hasRange ? { startedAt: dateFilter } : {}),
      })
        .select('encounterNumber type status startedAt endedAt chiefComplaint diagnosis departmentId attendingDoctorId')
        .populate([
          { path: 'departmentId', select: 'code name' },
          { path: 'attendingDoctorId', select: 'firstName lastName' },
        ])
        .sort({ startedAt: -1 })
        .limit(limit)
        .lean()
        .then((rows) =>
          rows.map((row) =>
            event({
              type: 'encounter',
              date: row.startedAt,
              title: `${row.type.toUpperCase()} visit — ${row.encounterNumber}`,
              summary: row.chiefComplaint || row.departmentId?.name || '',
              icon: '🏥',
              resourceId: row._id,
              encounterId: row._id,
              meta: {
                status: row.status,
                department: row.departmentId?.name,
                doctor: name(row.attendingDoctorId),
                diagnoses: (row.diagnosis ?? []).map((d) => d.description),
                endedAt: row.endedAt,
              },
            }),
          ),
        ),
    );
  }

  // --- Clinical notes (current versions only; the chain is on the note itself) ---
  if (wanted('note') && allowed(MODULES.CLINICAL_NOTES, 'view')) {
    sources.push(
      ClinicalNote.find({
        patientId,
        isActive: true,
        supersededBy: null,
        ...(hasRange ? { signedAt: dateFilter } : {}),
      })
        .select('noteType signedAt subjective objective assessment plan content authorName authorRole encounterId version')
        .sort({ signedAt: -1 })
        .limit(limit)
        .lean()
        .then((rows) =>
          rows.map((row) =>
            event({
              type: 'note',
              date: row.signedAt,
              title: `${row.noteType === 'soap' ? 'SOAP' : titleCase(row.noteType)} note`,
              summary: noteSummary(row),
              icon: '📝',
              resourceId: row._id,
              encounterId: row.encounterId,
              meta: {
                noteType: row.noteType,
                author: row.authorName,
                authorRole: row.authorRole,
                version: row.version,
                amended: row.version > 1,
              },
            }),
          ),
        ),
    );
  }

  // --- Observations ---
  if (wanted('vitals') && allowed(MODULES.ENCOUNTERS, 'view')) {
    sources.push(
      VitalSigns.find({
        patientId,
        isActive: true,
        ...(hasRange ? { recordedAt: dateFilter } : {}),
      })
        .select('recordedAt temperatureC pulseBpm systolicBp diastolicBp spo2 respiratoryRate painScore hasAbnormal hasCritical encounterId recordedBy')
        .populate({ path: 'recordedBy', select: 'firstName lastName' })
        .sort({ recordedAt: -1 })
        .limit(limit)
        .lean()
        .then((rows) =>
          rows.map((row) =>
            event({
              type: 'vitals',
              date: row.recordedAt,
              title: 'Observations',
              summary: vitalsSummary(row),
              icon: row.hasCritical ? '🔴' : '💓',
              resourceId: row._id,
              encounterId: row.encounterId,
              meta: {
                hasAbnormal: row.hasAbnormal,
                hasCritical: row.hasCritical,
                recordedBy: name(row.recordedBy),
              },
            }),
          ),
        ),
    );
  }

  // --- Lab orders ---
  if (wanted('labOrder') && allowed(MODULES.LAB_ORDERS, 'view')) {
    sources.push(
      LabOrder.find({
        patientId,
        isActive: true,
        ...(hasRange ? { createdAt: dateFilter } : {}),
      })
        .select('orderNumber status priority tests createdAt encounterId orderedBy')
        .populate({ path: 'orderedBy', select: 'firstName lastName' })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .then((rows) =>
          rows.map((row) =>
            event({
              type: 'labOrder',
              date: row.createdAt,
              title: `Lab order ${row.orderNumber}`,
              summary: (row.tests ?? []).map((t) => t.name).join(', '),
              icon: '🧪',
              resourceId: row._id,
              encounterId: row.encounterId,
              meta: {
                status: row.status,
                priority: row.priority,
                orderedBy: name(row.orderedBy),
                testCount: row.tests?.length ?? 0,
              },
            }),
          ),
        ),
    );
  }

  // --- Lab results ---
  if (wanted('labResult') && allowed(MODULES.LAB_RESULTS, 'view')) {
    sources.push(
      LabResult.find({
        patientId,
        isActive: true,
        ...(hasRange ? { createdAt: dateFilter } : {}),
      })
        .select('testName status createdAt encounterId hasCriticalValues hasAbnormalValues labOrderId')
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .then((rows) =>
          rows.map((row) =>
            event({
              type: 'labResult',
              date: row.createdAt,
              title: `Result — ${row.testName}`,
              summary: row.status,
              icon: row.hasCriticalValues ? '🔴' : '🔬',
              resourceId: row._id,
              encounterId: row.encounterId,
              meta: {
                status: row.status,
                hasAbnormal: row.hasAbnormalValues,
                hasCritical: row.hasCriticalValues,
                labOrderId: row.labOrderId,
              },
            }),
          ),
        ),
    );
  }

  // --- Radiology orders ---
  if (wanted('radiologyOrder') && allowed(MODULES.RADIOLOGY_ORDERS, 'view')) {
    sources.push(
      RadiologyOrder.find({
        patientId,
        isActive: true,
        ...(hasRange ? { createdAt: dateFilter } : {}),
      })
        .select('orderNumber status priority name modality code createdAt encounterId orderedBy')
        .populate({ path: 'orderedBy', select: 'firstName lastName' })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .then((rows) =>
          rows.map((row) =>
            event({
              type: 'radiologyOrder',
              date: row.createdAt,
              title: `Imaging ${row.orderNumber}`,
              summary: `${row.name} (${String(row.modality ?? '').toUpperCase()})`,
              icon: '🩻',
              resourceId: row._id,
              encounterId: row.encounterId,
              meta: {
                status: row.status,
                priority: row.priority,
                modality: row.modality,
                orderedBy: name(row.orderedBy),
              },
            }),
          ),
        ),
    );
  }

  // --- Radiology results ---
  if (wanted('radiologyResult') && allowed(MODULES.RADIOLOGY_RESULTS, 'view')) {
    sources.push(
      RadiologyResult.find({
        patientId,
        isActive: true,
        ...(hasRange ? { createdAt: dateFilter } : {}),
      })
        .select('impression status createdAt encounterId isCritical radiologyOrderId')
        .populate({ path: 'radiologyOrderId', select: 'orderNumber name modality' })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .then((rows) =>
          rows.map((row) =>
            event({
              type: 'radiologyResult',
              date: row.createdAt,
              title: `Imaging report — ${row.radiologyOrderId?.name ?? 'study'}`,
              summary: (row.impression ?? '').slice(0, 240) || row.status,
              icon: row.isCritical ? '🔴' : '🩻',
              resourceId: row._id,
              encounterId: row.encounterId,
              meta: {
                status: row.status,
                isCritical: row.isCritical,
                radiologyOrderId: row.radiologyOrderId?._id ?? row.radiologyOrderId,
              },
            }),
          ),
        ),
    );
  }

  // --- Prescriptions ---
  if (wanted('prescription') && allowed(MODULES.PRESCRIPTIONS, 'view')) {
    sources.push(
      Prescription.find({
        patientId,
        isActive: true,
        ...(hasRange ? { createdAt: dateFilter } : {}),
      })
        .select('prescriptionNumber status items createdAt encounterId prescribedBy')
        .populate({ path: 'prescribedBy', select: 'firstName lastName' })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .then((rows) =>
          rows.map((row) =>
            event({
              type: 'prescription',
              date: row.createdAt,
              title: `Prescription ${row.prescriptionNumber}`,
              summary: (row.items ?? []).map((item) => item.drugName).join(', '),
              icon: '💊',
              resourceId: row._id,
              encounterId: row.encounterId,
              meta: {
                status: row.status,
                prescribedBy: name(row.prescribedBy),
                itemCount: row.items?.length ?? 0,
              },
            }),
          ),
        ),
    );
  }

  // --- Dispenses ---
  if (wanted('dispense') && allowed(MODULES.DISPENSING, 'view')) {
    sources.push(
      Dispense.find({
        patientId,
        isActive: true,
        ...(hasRange ? { dispensedAt: dateFilter } : {}),
      })
        .select('dispenseNumber items allergyWarnings dispensedAt encounterId dispensedBy returnedAt')
        .populate({ path: 'dispensedBy', select: 'firstName lastName' })
        .sort({ dispensedAt: -1 })
        .limit(limit)
        .lean()
        .then((rows) =>
          rows.map((row) => {
            const overridden = (row.allergyWarnings ?? []).some((w) => w.overridden);
            return event({
              type: 'dispense',
              date: row.dispensedAt,
              title: `Dispensed ${row.dispenseNumber}`,
              summary: (row.items ?? [])
                .map((item) => `${item.drugName} × ${item.quantity}`)
                .join(', '),
              // An overridden allergy warning must be visible on the chart.
              icon: overridden ? '⚠️' : '💊',
              resourceId: row._id,
              encounterId: row.encounterId,
              meta: {
                dispensedBy: name(row.dispensedBy),
                allergyOverridden: overridden,
                returned: Boolean(row.returnedAt),
              },
            });
          }),
        ),
    );
  }

  // --- Appointments ---
  if (wanted('appointment') && allowed(MODULES.APPOINTMENTS, 'view')) {
    sources.push(
      Appointment.find({
        patientId,
        isActive: true,
        ...(hasRange ? { scheduledStart: dateFilter } : {}),
      })
        .select('appointmentNumber status type scheduledStart isWalkIn doctorId encounterId')
        .populate({ path: 'doctorId', select: 'firstName lastName' })
        .sort({ scheduledStart: -1 })
        .limit(limit)
        .lean()
        .then((rows) =>
          rows.map((row) =>
            event({
              type: 'appointment',
              date: row.scheduledStart,
              title: row.isWalkIn ? 'Walk-in' : `Appointment ${row.appointmentNumber}`,
              summary: [titleCase(row.type), name(row.doctorId)].filter(Boolean).join(' · '),
              icon: '📅',
              resourceId: row._id,
              encounterId: row.encounterId,
              meta: { status: row.status, isWalkIn: row.isWalkIn },
            }),
          ),
        ),
    );
  }

  const collected = (await Promise.all(sources)).flat();

  // One merged stream, newest first. Each source was already capped at `limit`,
  // so the merge is bounded even before this slice.
  return collected
    .filter((item) => item.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);
}

function titleCase(value = '') {
  return String(value).replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function noteSummary(note) {
  if (note.noteType === 'soap') {
    return (
      note.assessment?.trim() ||
      note.subjective?.trim() ||
      note.plan?.trim() ||
      note.objective?.trim() ||
      ''
    ).slice(0, 240);
  }
  return (note.content ?? '').slice(0, 240);
}

function vitalsSummary(row) {
  const parts = [];
  if (row.temperatureC !== undefined) parts.push(`${row.temperatureC}°C`);
  if (row.pulseBpm !== undefined) parts.push(`${row.pulseBpm} bpm`);
  if (row.systolicBp !== undefined && row.diastolicBp !== undefined) {
    parts.push(`${row.systolicBp}/${row.diastolicBp}`);
  }
  if (row.spo2 !== undefined) parts.push(`SpO₂ ${row.spo2}%`);
  if (row.respiratoryRate !== undefined) parts.push(`RR ${row.respiratoryRate}`);
  return parts.join(' · ');
}

export default { buildPatientTimeline };
