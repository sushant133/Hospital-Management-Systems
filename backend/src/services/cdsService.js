import { Patient, VitalSigns, MaternityCase, Prescription, Drug } from '../models/index.js';
import { checkAllergies } from './pharmacyService.js';
import { checkInteractions } from './safetyService.js';

function card({ summary, detail, indicator = 'info', source = 'HMS CDS' }) {
  return {
    uuid: `${indicator}-${summary}`.replace(/\s+/g, '-').slice(0, 80),
    summary,
    detail,
    indicator,
    source: { label: source },
  };
}

/**
 * patient-view hook: allergies, latest vitals, open ANC risk, current Rx DDI.
 * Not a certified CDS Hooks implementation — same card shape, hospital rules.
 */
export async function patientView({ patientId, encounterId }) {
  const cards = [];
  const patient = await Patient.findById(patientId).lean();
  if (!patient) return { cards };

  const allergies = patient.medicalHistory?.allergies ?? [];
  const severe = allergies.filter((a) => a.severity === 'severe');
  if (severe.length) {
    cards.push(
      card({
        indicator: 'critical',
        summary: `Severe allerg${severe.length === 1 ? 'y' : 'ies'}: ${severe.map((a) => a.substance).join(', ')}`,
        detail: 'Review before prescribing or administering.',
      }),
    );
  } else if (allergies.length) {
    cards.push(
      card({
        indicator: 'warning',
        summary: `Recorded allergies: ${allergies.map((a) => a.substance).join(', ')}`,
        detail: 'Matched against the formulary at prescribe and dispense.',
      }),
    );
  }

  const vitals = await VitalSigns.findOne({
    patientId,
    ...(encounterId ? { encounterId } : {}),
    isActive: true,
  })
    .sort({ recordedAt: -1, createdAt: -1 })
    .lean();
  if (vitals) {
    if (vitals.systolicBp != null && vitals.systolicBp >= 180) {
      cards.push(card({ indicator: 'critical', summary: `Hypertensive emergency range: SBP ${vitals.systolicBp}` }));
    }
    if (vitals.spo2 != null && vitals.spo2 < 90) {
      cards.push(card({ indicator: 'critical', summary: `Hypoxia: SpO₂ ${vitals.spo2}%` }));
    }
    if (vitals.gcs != null && vitals.gcs <= 8) {
      cards.push(card({ indicator: 'critical', summary: `Low GCS ${vitals.gcs}` }));
    }
  }

  const anc = await MaternityCase.findOne({ patientId, status: 'antenatal', isActive: true }).lean();
  if (anc?.highRisk) {
    cards.push(
      card({
        indicator: 'warning',
        summary: `High-risk ANC ${anc.caseNumber}`,
        detail: (anc.riskReasons ?? []).join('; ') || 'Flagged on the maternity case.',
      }),
    );
  }

  const rxs = await Prescription.find({
    patientId,
    status: { $ne: 'cancelled' },
    isActive: true,
  })
    .select('items')
    .lean();
  const drugIds = rxs.flatMap((rx) => (rx.items ?? []).map((i) => i.drugId).filter(Boolean));
  if (drugIds.length) {
    const drugs = await Drug.find({ _id: { $in: drugIds } }).lean();
    const interactions = await checkInteractions({ drugs });
    for (const hit of interactions.filter((i) => i.severity === 'severe')) {
      cards.push(
        card({
          indicator: 'critical',
          summary: `Severe interaction: ${hit.genericA} + ${hit.genericB}`,
          detail: hit.description,
        }),
      );
    }
    const allergyHits = checkAllergies({ drugs, allergies });
    for (const hit of allergyHits) {
      cards.push(
        card({
          indicator: hit.severity === 'severe' ? 'critical' : 'warning',
          summary: `Allergy vs ${hit.drugName ?? hit.substance}`,
          detail: `${hit.substance} (${hit.severity})`,
        }),
      );
    }
  }

  return { cards };
}

export function discovery() {
  return {
    services: [
      {
        hook: 'patient-view',
        title: 'HMS patient-view',
        description: 'Allergies, critical vitals, ANC risk, current Rx interactions.',
        id: 'patient-view',
      },
    ],
  };
}

export default { patientView, discovery };
