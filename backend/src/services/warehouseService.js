import {
  DailySnapshot,
  Encounter,
  Invoice,
  Payment,
  Claim,
  LabOrder,
  Surgery,
} from '../models/index.js';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export async function computeDailySnapshot(date = new Date()) {
  const from = startOfDay(date);
  const to = endOfDay(date);

  const [
    encountersOpened,
    encountersClosed,
    admissions,
    discharges,
    invoices,
    payments,
    claimsSubmitted,
    labOrders,
    surgeries,
  ] = await Promise.all([
    Encounter.countDocuments({ startedAt: { $gte: from, $lte: to } }),
    Encounter.countDocuments({ endedAt: { $gte: from, $lte: to } }),
    Encounter.countDocuments({ 'admission.admittedAt': { $gte: from, $lte: to } }),
    Encounter.countDocuments({ 'admission.dischargedAt': { $gte: from, $lte: to } }),
    Invoice.find({ issuedAt: { $gte: from, $lte: to }, isActive: true }).select('total').lean(),
    Payment.find({ receivedAt: { $gte: from, $lte: to }, isActive: true }).select('amount').lean(),
    Claim.countDocuments({ submittedAt: { $gte: from, $lte: to } }),
    LabOrder.countDocuments({ createdAt: { $gte: from, $lte: to } }),
    Surgery.countDocuments({ scheduledStart: { $gte: from, $lte: to } }),
  ]);

  const invoiceTotal = invoices.reduce((sum, row) => sum + (row.total ?? 0), 0);
  const paymentsTotal = payments.reduce((sum, row) => sum + (row.amount ?? 0), 0);

  const payload = {
    date: from,
    encountersOpened,
    encountersClosed,
    admissions,
    discharges,
    invoicesIssued: invoices.length,
    invoiceTotal,
    paymentsTotal,
    claimsSubmitted,
    labOrders,
    surgeries,
    computedAt: new Date(),
  };

  const row = await DailySnapshot.findOneAndUpdate({ date: from }, payload, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
  return row;
}

export default { computeDailySnapshot };
