import { CriticalAlert, LabResult, RadiologyResult, User, Encounter } from '../models/index.js';
import { ESCALATION_LEVELS } from '../models/CriticalAlert.js';
import { queue as queueSms } from './smsService.js';
import notify from './notificationService.js';
import ApiError from '../utils/ApiError.js';
import { ROLES } from '../config/roles.js';

/**
 * ============================================================================
 * THE CRITICAL RESULT LOOP
 * ============================================================================
 *
 * Raise → notify → acknowledge → action, with escalation when nobody answers.
 *
 * ---------------------------------------------------------------------------
 * THE ESCALATION WINDOWS ARE SHORT ON PURPOSE
 * ---------------------------------------------------------------------------
 * A critical potassium does not become less urgent because it is 2am. The
 * ladder climbs from the ordering clinician to the consultant to the duty
 * officer within the hour, because the alternative — waiting politely for
 * someone off shift — is how these results end up discovered at handover.
 *
 * These are defaults, held here rather than scattered, and a hospital may tune
 * them. What must not be tuned away is that the ladder terminates at a human
 * who is definitely present: the duty officer never times out to nobody.
 */
export const ESCALATION_MINUTES = Object.freeze([
  15, // ordering clinician
  15, // covering clinician
  20, // consultant
  0, // duty officer — terminal, no further rung
]);

/** Flags that mean "this value is life-threatening", not merely abnormal. */
const CRITICAL_FLAGS = new Set(['critical-low', 'critical-high', 'critical', 'panic']);

/**
 * Raise an alert for a verified lab result, if any value is critical.
 *
 * Called after verification rather than at entry: a preliminary value that a
 * technologist is still repeating should not page a consultant. Returns null
 * when nothing is critical, which is the common case.
 */
export async function raiseForLabResult({ resultId, user }) {
  const result = await LabResult.findById(resultId)
    .populate({ path: 'orderId', select: 'orderedBy encounterId orderNumber' })
    .lean();
  if (!result) throw ApiError.notFound('Result not found');

  const critical = (result.values || []).filter((v) => CRITICAL_FLAGS.has(v.flag));
  if (critical.length === 0) return null;

  // An amended result supersedes its predecessor's alert rather than adding a
  // second one — two pages for one patient is how a ward learns to ignore them.
  await supersedeExisting({ source: 'lab', sourceId: result._id });

  const findings = critical.map((v) => ({
    analyte: v.analyteName || v.analyteCode || 'value',
    value: String(v.value ?? v.numericValue ?? ''),
    unit: v.unit || '',
    flag: v.flag,
    criticalLow: v.criticalLow ?? null,
    criticalHigh: v.criticalHigh ?? null,
  }));

  return createAlert({
    source: 'lab',
    sourceId: result._id,
    sourceRef: result.orderId?.orderNumber || '',
    patientId: result.patientId,
    encounterId: result.encounterId || result.orderId?.encounterId || null,
    orderingClinicianId: result.orderId?.orderedBy || null,
    summary: `Critical lab result: ${findings.map((f) => `${f.analyte} ${f.value}${f.unit}`).join(', ')}`,
    findings,
    user,
  });
}

/**
 * Raise an alert for a radiology report the radiologist marked critical.
 *
 * Radiology criticals are declared by a human rather than computed from a
 * range — a tension pneumothorax has no numeric threshold — so this trusts the
 * reporting radiologist's flag.
 */
export async function raiseForRadiologyResult({ resultId, user }) {
  const result = await RadiologyResult.findById(resultId)
    .populate({ path: 'orderId', select: 'orderedBy encounterId orderNumber' })
    .lean();
  if (!result) throw ApiError.notFound('Result not found');
  if (!result.isCriticalFinding) return null;

  await supersedeExisting({ source: 'radiology', sourceId: result._id });

  return createAlert({
    source: 'radiology',
    sourceId: result._id,
    sourceRef: result.orderId?.orderNumber || '',
    patientId: result.patientId,
    encounterId: result.encounterId || result.orderId?.encounterId || null,
    orderingClinicianId: result.orderId?.orderedBy || null,
    summary: `Critical imaging finding: ${result.criticalFindingSummary || result.impression || 'see report'}`,
    findings: [],
    user,
  });
}

/** Cancel any live alert for a result that has just been superseded. */
async function supersedeExisting({ source, sourceId }) {
  await CriticalAlert.updateMany(
    { source, sourceId, status: { $in: ['open', 'notified', 'escalated'] } },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: 'Superseded by an amended result.',
      },
    },
  );
}

async function createAlert({
  source,
  sourceId,
  sourceRef,
  patientId,
  encounterId,
  orderingClinicianId,
  summary,
  findings,
  user,
}) {
  const escalateAfter = new Date(Date.now() + ESCALATION_MINUTES[0] * 60000);

  const alert = await CriticalAlert.create({
    source,
    sourceId,
    sourceRef,
    patientId,
    encounterId,
    orderingClinicianId,
    summary,
    findings,
    status: 'open',
    escalationLevel: 0,
    escalateAfter,
    createdBy: user?._id ?? null,
    updatedBy: user?._id ?? null,
  });

  await notifyLevel({ alert, level: 0 });
  return alert;
}

/* ==========================================================================
 * NOTIFICATION AND ESCALATION
 * ======================================================================= */

/** Who occupies a given rung of the ladder for this alert. */
async function recipientsFor({ alert, level }) {
  const rung = ESCALATION_LEVELS[level];

  if (rung === 'ordering-clinician' && alert.orderingClinicianId) {
    const user = await User.findById(alert.orderingClinicianId).select('firstName lastName phone role').lean();
    if (user) return [user];
  }

  if (rung === 'covering-clinician' || rung === 'ordering-clinician') {
    // Fall back to whoever is attending this encounter.
    const encounter = alert.encounterId
      ? await Encounter.findById(alert.encounterId).select('attendingDoctorId departmentId').lean()
      : null;
    if (encounter?.attendingDoctorId) {
      const user = await User.findById(encounter.attendingDoctorId)
        .select('firstName lastName phone role')
        .lean();
      if (user) return [user];
    }
  }

  if (rung === 'consultant') {
    const encounter = alert.encounterId
      ? await Encounter.findById(alert.encounterId).select('departmentId').lean()
      : null;
    if (encounter?.departmentId) {
      return User.find({ role: ROLES.DOCTOR, departmentId: encounter.departmentId, isActive: true })
        .select('firstName lastName phone role')
        .limit(5)
        .lean();
    }
  }

  // Duty officer — the terminal rung. Every admin is paged rather than none,
  // because an alert that escalates to an empty set has silently failed.
  return User.find({ role: ROLES.ADMIN, isActive: true })
    .select('firstName lastName phone role')
    .limit(5)
    .lean();
}

/**
 * Page one rung of the ladder.
 *
 * Both in-app and SMS: the ward PC may be unattended, and a critical result is
 * exactly the case where the extra message cost is irrelevant.
 */
export async function notifyLevel({ alert, level }) {
  const recipients = await recipientsFor({ alert, level });
  const rung = ESCALATION_LEVELS[level];

  for (const recipient of recipients) {
    await notify({
      userId: recipient._id,
      type: 'critical-result',
      title: `CRITICAL: ${alert.summary}`,
      body: `Alert ${alert.alertNumber}. Acknowledge in the critical results board.`,
      patientId: alert.patientId,
      resourceType: 'CriticalAlert',
      resourceId: alert._id,
    });

    if (recipient.phone) {
      await queueSms({
        to: recipient.phone,
        template: 'lab-result-ready',
        locale: 'en',
        values: {},
        userId: recipient._id,
        patientId: alert.patientId,
        resourceType: 'CriticalAlert',
        resourceId: alert._id,
        // Distinct per rung so an escalation is not swallowed as a duplicate
        // of the page that already went out.
        dedupeKey: `crit:${alert._id}:${level}:${recipient._id}`,
      });
    }

    alert.notifications.push({
      level: rung,
      userId: recipient._id,
      userName: `${recipient.firstName} ${recipient.lastName}`.trim(),
      channel: 'in-app',
      sentAt: new Date(),
      delivered: true,
    });
  }

  if (alert.status === 'open') alert.status = 'notified';
  await alert.save();

  return recipients.length;
}

/**
 * Move every overdue alert up one rung. Driven by a job, not a request.
 *
 * The terminal rung does not escalate further but stays `escalated` and on the
 * board — it must never quietly resolve itself.
 */
export async function escalateOverdue({ now = new Date() } = {}) {
  const due = await CriticalAlert.find({
    status: { $in: ['open', 'notified', 'escalated'] },
    acknowledgedAt: null,
    escalateAfter: { $ne: null, $lte: now },
  }).limit(200);

  const results = { escalated: 0, terminal: 0 };

  for (const alert of due) {
    const nextLevel = alert.escalationLevel + 1;

    if (nextLevel >= ESCALATION_LEVELS.length) {
      // Already at the duty officer. Stop the timer but leave it open and
      // visible; there is nobody above to tell.
      alert.status = 'escalated';
      alert.escalateAfter = null;
      await alert.save();
      results.terminal += 1;
      continue;
    }

    alert.escalationLevel = nextLevel;
    alert.status = 'escalated';
    alert.escalatedAt = new Date();
    const window = ESCALATION_MINUTES[nextLevel];
    alert.escalateAfter = window > 0 ? new Date(now.getTime() + window * 60000) : null;

    await notifyLevel({ alert, level: nextLevel });
    results.escalated += 1;
  }

  return results;
}

/* ==========================================================================
 * CLOSING THE LOOP
 * ======================================================================= */

/**
 * A named clinician has seen the result.
 *
 * Stops the escalation timer but does NOT close the alert — seeing is not
 * treating, and collapsing the two would let a glance count as care.
 */
export async function acknowledge({ alertId, user, channel = 'in-app', note = '' }) {
  const alert = await CriticalAlert.findById(alertId);
  if (!alert) throw ApiError.notFound('Alert not found');
  if (alert.status === 'cancelled') throw ApiError.conflict('This alert was cancelled.');
  if (alert.acknowledgedAt) {
    return { alert, alreadyAcknowledged: true };
  }

  alert.acknowledgedBy = user._id;
  alert.acknowledgedAt = new Date();
  alert.acknowledgementChannel = channel;
  alert.status = 'acknowledged';
  alert.escalateAfter = null;
  if (note) {
    alert.notifications.push({
      level: ESCALATION_LEVELS[alert.escalationLevel],
      userId: user._id,
      userName: `${user.firstName} ${user.lastName}`.trim(),
      channel: channel === 'phone-readback' ? 'phone' : 'in-app',
      note,
      delivered: true,
    });
  }
  alert.updatedBy = user._id;
  await alert.save();

  return { alert, alreadyAcknowledged: false };
}

/** Record what was actually done — the line a coroner reads. */
export async function recordAction({ alertId, user, actionTaken }) {
  const alert = await CriticalAlert.findById(alertId);
  if (!alert) throw ApiError.notFound('Alert not found');
  if (!alert.acknowledgedAt) {
    throw ApiError.conflict('Acknowledge the alert before recording what was done.', {
      code: 'NOT_ACKNOWLEDGED',
    });
  }

  alert.actionedBy = user._id;
  alert.actionedAt = new Date();
  alert.actionTaken = actionTaken;
  alert.status = 'actioned';
  alert.updatedBy = user._id;
  await alert.save();

  return alert;
}

/**
 * The standing board.
 *
 * What a duty officer looks at, and the first thing a regulator asks to see.
 */
export async function outstandingBoard({ includeAcknowledged = false } = {}) {
  const statuses = includeAcknowledged
    ? ['open', 'notified', 'escalated', 'acknowledged']
    : ['open', 'notified', 'escalated'];

  const rows = await CriticalAlert.find({ status: { $in: statuses }, isActive: true })
    .populate({ path: 'patientId', select: 'mrn firstName lastName' })
    .populate({ path: 'orderingClinicianId acknowledgedBy', select: 'firstName lastName' })
    .sort({ raisedAt: 1 })
    .limit(200)
    .lean({ virtuals: true });

  const overdue = rows.filter((r) => r.escalateAfter && new Date(r.escalateAfter) < new Date());

  return {
    alerts: rows,
    counts: {
      total: rows.length,
      unacknowledged: rows.filter((r) => !r.acknowledgedAt).length,
      overdue: overdue.length,
      atDutyOfficer: rows.filter((r) => r.escalationLevel >= ESCALATION_LEVELS.length - 1).length,
    },
  };
}

export default {
  raiseForLabResult,
  raiseForRadiologyResult,
  acknowledge,
  recordAction,
  escalateOverdue,
  outstandingBoard,
  ESCALATION_MINUTES,
};
