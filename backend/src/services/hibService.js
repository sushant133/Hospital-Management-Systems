import { HibHousehold, Encounter } from '../models/index.js';
import { roundPaisa } from '../utils/nepal.js';
import ApiError from '../utils/ApiError.js';

/**
 * ============================================================================
 * HEALTH INSURANCE BOARD — ELIGIBILITY, REFERRAL AND CEILING
 * ============================================================================
 *
 * The three questions the counter has to answer before a HIB patient is
 * treated, in the order they matter:
 *
 *   1. Is this family's cover live?
 *   2. Does this hospital have the right to claim for them — i.e. were they
 *      referred, or is this an emergency?
 *   3. How much of the shared ceiling is left?
 *
 * Getting any of these wrong is not a billing inconvenience. The care is
 * delivered either way; what changes is whether the hospital is ever paid for
 * it. A rejected HIB claim is discovered months later and is, in practice,
 * unrecoverable — the patient has gone home believing they owed nothing.
 */

/** Reasons cover can fail, as stable codes the UI can translate. */
export const HIB_DENIAL_REASONS = Object.freeze({
  NOT_ENROLLED: 'not-enrolled',
  POLICY_LAPSED: 'policy-lapsed',
  POLICY_NOT_STARTED: 'policy-not-started',
  MEMBER_INACTIVE: 'member-inactive',
  CEILING_EXHAUSTED: 'ceiling-exhausted',
  REFERRAL_MISSING: 'referral-missing',
  HOUSEHOLD_SUSPENDED: 'household-suspended',
});

/**
 * Full eligibility check for one patient at one moment.
 *
 * Returns a decision object rather than throwing, because "not covered" is a
 * normal answer the counter needs to act on — the patient is treated either
 * way, they simply pay differently.
 */
export async function checkEligibility({ patientId, asOf = new Date(), isEmergency = false }) {
  const household = await HibHousehold.findOne({
    'members.patientId': patientId,
    'members.status': 'active',
    isActive: true,
  });

  if (!household) {
    return {
      covered: false,
      reason: HIB_DENIAL_REASONS.NOT_ENROLLED,
      message: 'This patient is not on any Health Insurance Board household policy.',
    };
  }

  const member = household.memberFor(patientId);
  if (!member) {
    return {
      covered: false,
      household,
      reason: HIB_DENIAL_REASONS.MEMBER_INACTIVE,
      message: 'The patient is listed on the household but their membership is not active.',
    };
  }

  if (household.status === 'suspended' || household.status === 'cancelled') {
    return {
      covered: false,
      household,
      member,
      reason: HIB_DENIAL_REASONS.HOUSEHOLD_SUSPENDED,
      message: `The household policy is ${household.status}.`,
    };
  }

  if (new Date(household.policyFrom) > asOf) {
    return {
      covered: false,
      household,
      member,
      reason: HIB_DENIAL_REASONS.POLICY_NOT_STARTED,
      message: 'The policy period has not begun yet.',
    };
  }

  if (new Date(household.policyTo) < asOf) {
    return {
      covered: false,
      household,
      member,
      reason: HIB_DENIAL_REASONS.POLICY_LAPSED,
      message: 'The policy has expired — the premium needs renewing before cover resumes.',
    };
  }

  const remaining = household.remainingCeiling;
  if (remaining <= 0) {
    return {
      covered: false,
      household,
      member,
      remainingCeiling: 0,
      reason: HIB_DENIAL_REASONS.CEILING_EXHAUSTED,
      message:
        'The household has used its full annual ceiling. Treatment is billable to the patient.',
    };
  }

  return {
    covered: true,
    household,
    member,
    remainingCeiling: remaining,
    copayPercent: household.copayPercent || 0,
    // The referral test is separate: cover can be live while this hospital
    // still has no right to claim. Both must pass, and conflating them is how
    // a hospital ends up treating on a policy it cannot bill.
    referral: evaluateReferral({ household, isEmergency }),
  };
}

/**
 * Does this hospital have the right to claim for this member?
 *
 * A member is registered to a first contact point and must ordinarily be
 * referred upward from it. Emergencies waive the requirement — which is why
 * `isEmergency` has to come from the encounter type rather than from whoever
 * is at the counter.
 */
export function evaluateReferral({ household, isEmergency = false }) {
  if (isEmergency) {
    return {
      required: false,
      satisfied: true,
      note: 'Emergency presentation — the referral requirement is waived.',
    };
  }
  if (!household.requiresReferral) {
    return { required: false, satisfied: true, note: 'This policy carries no referral condition.' };
  }
  return {
    required: true,
    satisfied: false, // the caller confirms against the encounter's referral record
    firstContactPoint: household.firstContactPointName || household.firstContactPointCode,
    note:
      'A referral from the household’s first contact point must be recorded, or ' +
      'the claim will be rejected.',
  };
}

/**
 * Confirm the referral condition against what is actually on the encounter.
 *
 * Called at admission/registration rather than at billing, deliberately: this
 * is the last moment the missing paperwork can still be obtained.
 */
export async function verifyReferralOnEncounter({ encounterId, household }) {
  const encounter = await Encounter.findById(encounterId).lean();
  if (!encounter) throw new ApiError(404, 'Encounter not found.');

  const isEmergency = encounter.type === 'emergency';
  const base = evaluateReferral({ household, isEmergency });
  if (!base.required) return base;

  const referral = encounter.referral;
  const hasReferral = Boolean(referral?.referringFacilityCode && referral?.referralDate);

  return {
    ...base,
    satisfied: hasReferral,
    referral: referral || null,
    note: hasReferral
      ? `Referred by ${referral.referringFacilityName || referral.referringFacilityCode}.`
      : base.note,
  };
}

/**
 * How much of a bill HIB will bear, given the live ceiling and any copay.
 *
 * Pure — writes nothing. The counter shows this to the patient before
 * treatment, and the billing service uses the same function at invoice time, so
 * the number the patient was quoted is the number that appears on the bill.
 */
export function apportionAgainstCeiling({ billableAmount, remainingCeiling, copayPercent = 0 }) {
  const gross = roundPaisa(Math.max(0, billableAmount));

  // Copay comes off the top and always belongs to the patient.
  const copay = roundPaisa((gross * (copayPercent || 0)) / 100);
  const claimable = roundPaisa(gross - copay);

  const insurerShare = roundPaisa(Math.min(claimable, Math.max(0, remainingCeiling)));
  const patientShare = roundPaisa(gross - insurerShare);

  return {
    grossAmount: gross,
    copayAmount: copay,
    insuranceCoveredAmount: insurerShare,
    patientResponsibleAmount: patientShare,
    /** True when the ceiling ran out mid-bill — the counter must tell the patient. */
    ceilingExhausted: insurerShare < claimable,
    ceilingShortfall: roundPaisa(Math.max(0, claimable - insurerShare)),
  };
}

/**
 * Draw down the household ceiling once a claim is raised.
 *
 * Guards against over-drawing under concurrency with a conditional update: two
 * counters billing two family members at once must not both see the same
 * remaining balance and each claim it. The filter re-checks the balance at
 * write time, so the loser gets zero rows modified and can re-read.
 */
export async function drawDownCeiling({ householdId, amount }) {
  const draw = roundPaisa(amount);
  if (draw <= 0) return { drawn: 0, remaining: null };

  const result = await HibHousehold.findOneAndUpdate(
    {
      _id: householdId,
      status: 'active',
      // Only if there is genuinely enough left. Without this the two-counter
      // race silently issues cover the Board will not honour.
      $expr: { $gte: [{ $subtract: ['$ceilingAmount', '$utilisedAmount'] }, draw] },
    },
    { $inc: { utilisedAmount: draw } },
    { new: true },
  );

  if (!result) {
    throw new ApiError(
      409,
      'The household ceiling changed while this bill was being prepared. ' +
        'Re-check the remaining balance and apportion again.',
      'HIB_CEILING_CONFLICT',
    );
  }

  return { drawn: draw, remaining: result.remainingCeiling };
}

/** Release a drawdown when a claim is withdrawn or rejected. */
export async function releaseCeiling({ householdId, amount }) {
  const release = roundPaisa(amount);
  if (release <= 0) return null;
  return HibHousehold.findByIdAndUpdate(
    householdId,
    // Never below zero, even if a release is somehow applied twice.
    [
      {
        $set: {
          utilisedAmount: { $max: [0, { $subtract: ['$utilisedAmount', release] }] },
        },
      },
    ],
    { new: true },
  );
}

export default {
  checkEligibility,
  evaluateReferral,
  verifyReferralOnEncounter,
  apportionAgainstCeiling,
  drawDownCeiling,
  releaseCeiling,
  HIB_DENIAL_REASONS,
};
