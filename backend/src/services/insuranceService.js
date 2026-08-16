import { BillingLineItem, Claim, PatientPolicy } from '../models/index.js';
import ApiError from '../utils/ApiError.js';

/**
 * Insurance arithmetic: who is covered, for how much, and how old the money is.
 *
 * Kept out of the controller because the co-pay split is the part a finance
 * office will want demonstrated rather than taken on trust — it decides what
 * the patient is asked to pay at the desk.
 */

const round = (value) => Math.round(value * 100) / 100;

// ----------------------------------------------------------- eligibility ----

/**
 * Is this policy usable today, and for how much?
 *
 * Returns a reason rather than a bare boolean: "expired last month" and
 * "annual limit reached" need different answers at the front desk.
 */
export function checkEligibility(policy, provider, { at = new Date() } = {}) {
  const reasons = [];

  if (!policy) {
    return { eligible: false, reasons: ['No policy on record'], coverageRemaining: 0 };
  }

  if (policy.status === 'suspended') reasons.push('The policy is suspended');
  if (policy.status === 'expired') reasons.push('The policy is marked expired');

  const from = new Date(policy.validFrom);
  const till = new Date(policy.validTill);
  if (at < from) reasons.push(`Cover does not start until ${from.toISOString().slice(0, 10)}`);
  if (at > till) reasons.push(`Cover ended on ${till.toISOString().slice(0, 10)}`);

  const limit = policy.coverageLimit ?? 0;
  const used = policy.coverageUsed ?? 0;
  const coverageRemaining = limit ? Math.max(0, limit - used) : Infinity;

  if (limit && coverageRemaining <= 0) {
    reasons.push(`The annual limit of ${limit} has been used in full`);
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    coverageRemaining,
    coPayPercent: effectiveCoPay(policy, provider),
    verified: Boolean(policy.verifiedAt),
    verifiedAt: policy.verifiedAt ?? null,
  };
}

/** The policy's co-pay, or the provider's default when it sets none. */
export function effectiveCoPay(policy, provider) {
  if (policy?.coPayPercent !== null && policy?.coPayPercent !== undefined) {
    return policy.coPayPercent;
  }
  return provider?.defaultCoPayPercent ?? 0;
}

// --------------------------------------------------------------- co-pay ----

/**
 * Split an amount between the insurer and the patient.
 *
 * Two things reduce the insurer's share, in this order:
 *   1. the co-pay percentage — the patient's contractual contribution;
 *   2. whatever is left of the annual limit — anything beyond it falls back to
 *      the patient, because the insurer will simply not pay it.
 *
 * The patient's total is therefore their co-pay *plus* any excess over the
 * limit, which is the number the desk actually asks for.
 */
export function splitCoPay({ grossAmount, policy, provider }) {
  const gross = round(Math.max(0, grossAmount));
  const coPayPercent = effectiveCoPay(policy, provider);

  const patientCoPay = round((gross * coPayPercent) / 100);
  let insurerShare = round(gross - patientCoPay);

  const limit = policy?.coverageLimit ?? 0;
  const remaining = limit ? Math.max(0, limit - (policy.coverageUsed ?? 0)) : Infinity;

  let overLimit = 0;
  if (insurerShare > remaining) {
    overLimit = round(insurerShare - remaining);
    insurerShare = round(remaining);
  }

  return {
    grossAmount: gross,
    coPayPercent,
    patientCoPay,
    overLimit,
    // Everything the patient owes: their co-pay plus anything cover will not reach.
    patientResponsible: round(patientCoPay + overLimit),
    insurerShare,
    coverageRemainingBefore: remaining === Infinity ? null : remaining,
  };
}

// ---------------------------------------------------------------- claims ----

/**
 * The charges on an encounter that can be claimed.
 *
 * Built from the shared billing ledger. **Phase 10 has not issued invoices
 * yet**, so a claim is raised against the encounter's charge lines directly;
 * `Claim.invoiceId` is ready for when it does. Cancelled lines are excluded,
 * and lines already on another live claim are not offered twice.
 */
export async function claimableCharges({ encounterId, excludeClaimId = null }) {
  const lines = await BillingLineItem.find({
    encounterId,
    isActive: true,
    status: { $ne: 'cancelled' },
  })
    .sort({ chargedAt: 1 })
    .lean();

  // Anything already claimed elsewhere must not be claimed again.
  const claimFilter = {
    encounterId,
    isActive: true,
    status: { $nin: ['rejected'] },
  };
  if (excludeClaimId) claimFilter._id = { $ne: excludeClaimId };

  const existing = await Claim.find(claimFilter).select('lines.billingLineItemId').lean();
  const alreadyClaimed = new Set(
    existing.flatMap((claim) => claim.lines.map((line) => String(line.billingLineItemId))),
  );

  return lines.filter((line) => !alreadyClaimed.has(String(line._id)));
}

/** Charges an insurer refuses outright, matched against their exclusion list. */
export function applyExclusions(lines, provider) {
  const exclusions = (provider?.exclusions ?? []).map((entry) => entry.toLowerCase().trim());
  if (!exclusions.length) return { covered: lines, excluded: [] };

  const covered = [];
  const excluded = [];

  for (const line of lines) {
    const haystack = `${line.description} ${line.itemCode} ${line.sourceType}`.toLowerCase();
    const hit = exclusions.find((term) => term && haystack.includes(term));
    if (hit) excluded.push({ ...line, exclusionMatched: hit });
    else covered.push(line);
  }

  return { covered, excluded };
}

/**
 * Move a policy's used-coverage total.
 *
 * Called when an insurer approves (consuming cover) and when an approval is
 * later reduced or reversed, so the remaining limit stays honest.
 */
export async function adjustCoverageUsed({ policyId, delta, user }) {
  if (!delta) return null;

  const policy = await PatientPolicy.findById(policyId);
  if (!policy) throw ApiError.notFound('Policy not found');

  policy.coverageUsed = Math.max(0, round((policy.coverageUsed ?? 0) + delta));
  policy.updatedBy = user?._id ?? null;
  await policy.save();

  return policy;
}

// -------------------------------------------------------------- reporting ----

/** Standard receivables buckets, in days since submission. */
export const AGING_BUCKETS = [
  { key: '0-30', min: 0, max: 30 },
  { key: '31-60', min: 31, max: 60 },
  { key: '61-90', min: 61, max: 90 },
  { key: '90+', min: 91, max: Infinity },
];

/**
 * Outstanding claims by age and by insurer.
 *
 * "Outstanding" means submitted and not yet settled. Overdue is measured
 * against each insurer's own contractual `settlementDays` rather than a fixed
 * number, so a 45-day insurer is not reported as late at 31 days.
 */
export async function agingReport({ providerId = null, asOf = new Date() } = {}) {
  const filter = {
    isActive: true,
    submittedAt: { $ne: null },
    status: { $in: ['submitted', 'under-review', 'approved', 'partially-approved', 'resubmitted'] },
  };
  if (providerId) filter.providerId = providerId;

  const claims = await Claim.find(filter)
    .populate({ path: 'providerId', select: 'code name settlementDays' })
    .populate({ path: 'patientId', select: 'mrn firstName lastName' })
    .lean();

  const buckets = Object.fromEntries(
    AGING_BUCKETS.map((bucket) => [bucket.key, { count: 0, amount: 0 }]),
  );
  const byProvider = new Map();
  let overdueCount = 0;
  let overdueAmount = 0;

  const rows = claims.map((claim) => {
    const age = Math.floor((asOf - new Date(claim.submittedAt)) / 86400000);
    const outstanding = round(
      ['approved', 'partially-approved'].includes(claim.status)
        ? (claim.approvedAmount ?? 0) - (claim.settledAmount ?? 0)
        : claim.claimedAmount ?? 0,
    );

    const bucket = AGING_BUCKETS.find((b) => age >= b.min && age <= b.max) ?? AGING_BUCKETS[3];
    buckets[bucket.key].count += 1;
    buckets[bucket.key].amount = round(buckets[bucket.key].amount + outstanding);

    const terms = claim.providerId?.settlementDays ?? 30;
    const overdue = age > terms;
    if (overdue) {
      overdueCount += 1;
      overdueAmount = round(overdueAmount + outstanding);
    }

    const key = String(claim.providerId?._id ?? 'unknown');
    if (!byProvider.has(key)) {
      byProvider.set(key, {
        providerId: claim.providerId?._id ?? null,
        provider: claim.providerId?.name ?? 'Unknown',
        count: 0,
        amount: 0,
        overdue: 0,
      });
    }
    const entry = byProvider.get(key);
    entry.count += 1;
    entry.amount = round(entry.amount + outstanding);
    if (overdue) entry.overdue += 1;

    return {
      _id: claim._id,
      claimNumber: claim.claimNumber,
      patient: claim.patientId,
      provider: claim.providerId?.name,
      status: claim.status,
      submittedAt: claim.submittedAt,
      ageDays: age,
      settlementDays: terms,
      overdue,
      outstanding,
      bucket: bucket.key,
    };
  });

  return {
    claims: rows.sort((a, b) => b.ageDays - a.ageDays),
    buckets,
    byProvider: [...byProvider.values()].sort((a, b) => b.amount - a.amount),
    totals: {
      count: rows.length,
      amount: round(rows.reduce((sum, row) => sum + row.outstanding, 0)),
      overdueCount,
      overdueAmount,
    },
  };
}

/** Settled claims over a period: what was claimed against what was paid. */
export async function settlementReport({ from, to, providerId = null } = {}) {
  const filter = { isActive: true, settledAt: { $ne: null } };
  if (from || to) {
    filter.settledAt = {};
    if (from) filter.settledAt.$gte = from;
    if (to) filter.settledAt.$lte = to;
  }
  if (providerId) filter.providerId = providerId;

  const claims = await Claim.find(filter)
    .populate({ path: 'providerId', select: 'code name' })
    .lean();

  const byProvider = new Map();

  for (const claim of claims) {
    const key = String(claim.providerId?._id ?? 'unknown');
    if (!byProvider.has(key)) {
      byProvider.set(key, {
        providerId: claim.providerId?._id ?? null,
        provider: claim.providerId?.name ?? 'Unknown',
        claims: 0,
        claimed: 0,
        approved: 0,
        settled: 0,
        rejected: 0,
      });
    }
    const entry = byProvider.get(key);
    entry.claims += 1;
    entry.claimed = round(entry.claimed + (claim.claimedAmount ?? 0));
    entry.approved = round(entry.approved + (claim.approvedAmount ?? 0));
    entry.settled = round(entry.settled + (claim.settledAmount ?? 0));
    entry.rejected = round(entry.rejected + (claim.rejectedAmount ?? 0));
  }

  const rows = [...byProvider.values()].map((row) => ({
    ...row,
    // What proportion of what was asked for actually arrived.
    settlementRate: row.claimed ? Math.round((row.settled / row.claimed) * 1000) / 10 : 0,
  }));

  return {
    providers: rows.sort((a, b) => b.settled - a.settled),
    totals: {
      claims: claims.length,
      claimed: round(rows.reduce((s, r) => s + r.claimed, 0)),
      settled: round(rows.reduce((s, r) => s + r.settled, 0)),
      rejected: round(rows.reduce((s, r) => s + r.rejected, 0)),
    },
  };
}

export default {
  checkEligibility,
  effectiveCoPay,
  splitCoPay,
  claimableCharges,
  applyExclusions,
  adjustCoverageUsed,
  agingReport,
  settlementReport,
};
