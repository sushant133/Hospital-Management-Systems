import {
  Invoice,
  Payment,
  BillingLineItem,
  Encounter,
  Bed,
  Ward,
  Appointment,
  InventoryItem,
  InventoryTransaction,
  DrugBatch,
  LabOrder,
  LabResult,
  RadiologyOrder,
  Claim,
  Attendance,
  User,
  Department,
  Patient,
  STANDARD_SHIFT_HOURS,
  PAYABLE_FRACTION,
} from '../models/index.js';

/**
 * Reporting aggregations.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE NUMBERS MEAN
 * ---------------------------------------------------------------------------
 * Management reports get argued over, so the choices behind them are stated
 * here rather than left to be reverse-engineered from pipelines:
 *
 *   1. **Billed and collected are reported separately, never merged.** Billed is
 *      what was invoiced in the range; collected is money that actually arrived.
 *      They diverge whenever a bill is unpaid, and a single "revenue" figure
 *      would hide which one it meant.
 *   2. **Void invoices are excluded everywhere.** A cancelled bill is not
 *      revenue, and counting it would make the ledger and the report disagree.
 *   3. **Revenue by department comes from the charge ledger, not the invoice.**
 *      An invoice belongs to one encounter and therefore one department, but its
 *      charges may span several — a lab test ordered during a surgical stay
 *      belongs to the lab. Attributing by `billingLineItems.departmentId` credits
 *      the department that actually did the work.
 *   4. **Average length of stay counts discharged stays only.** A patient still
 *      in a bed has no length yet; including them would drag the average down by
 *      the length of the census rather than the length of a stay.
 *   5. **Occupancy is point-in-time, not a range average.** Beds are counted as
 *      they stand now; cleaning and maintenance count as unavailable, because a
 *      bed that cannot take a patient is not capacity.
 *   6. **Turnaround is measured to completion, not to report signing**, and only
 *      over orders that reached it — a still-open order has no turnaround.
 *
 * Nothing here writes. Every function is a read over existing collections, so a
 * report can never corrupt what it reports on.
 */

const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Orders that have not reached a result yet, per module's own status list. */
const LAB_PENDING = ['ordered', 'collected', 'in-progress'];
const RADIOLOGY_PENDING = ['ordered', 'scheduled', 'in-progress'];

/**
 * The server's IANA zone, passed to `$dateToString` so a "day" in the report is
 * the hospital's day rather than a UTC one — otherwise the daily revenue bucket
 * rolls over in the middle of a night shift. MongoDB resolves DST from the zone
 * name, which a fixed `+05:30`-style offset could not.
 */
function reportTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Normalise a requested range, defaulting to the last 30 days.
 *
 * `to` is pushed to the end of its day: a user asking for "1st to 31st" means
 * the whole of the 31st, and an exclusive bound would silently drop a day's
 * takings.
 */
export function resolveRange({ from, to } = {}) {
  const end = to ? new Date(to) : new Date();
  end.setHours(23, 59, 59, 999);

  let start;
  if (from) {
    start = new Date(from);
  } else {
    start = new Date(end);
    start.setDate(start.getDate() - 29);
  }
  start.setHours(0, 0, 0, 0);

  if (start > end) throw new Error('The start of the range is after its end');

  return { start, end };
}

/** Bucket key expression for a date field, by day or month. */
function bucketExpr(field, groupBy) {
  return {
    $dateToString: {
      format: groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d',
      date: `$${field}`,
      timezone: reportTimezone(),
    },
  };
}

// ============================================================== revenue ====

/**
 * Money billed and money collected, cut by time, department and payer.
 *
 * See notes 1–3 above: billed and collected are different questions, and the
 * departmental cut deliberately reads the ledger rather than the invoice.
 */
export async function revenueReport({ start, end, groupBy = 'day' }) {
  const invoiceMatch = {
    isActive: true,
    status: { $ne: 'void' },
    issuedAt: { $gte: start, $lte: end },
  };

  const [billedSeries, collectedSeries, totals, byDepartment, byPayer, byInsurer, byMethod] =
    await Promise.all([
      Invoice.aggregate([
        { $match: invoiceMatch },
        {
          $group: {
            _id: bucketExpr('issuedAt', groupBy),
            billed: { $sum: '$total' },
            invoices: { $sum: 1 },
          },
        },
      ]),

      // Payments carry refunds as negative rows, so summing `amount` gives the
      // net movement without a special case.
      Payment.aggregate([
        { $match: { isActive: true, receivedAt: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: bucketExpr('receivedAt', groupBy),
            collected: { $sum: '$amount' },
            receipts: { $sum: 1 },
          },
        },
      ]),

      Invoice.aggregate([
        { $match: invoiceMatch },
        {
          $group: {
            _id: null,
            billed: { $sum: '$total' },
            discounts: { $sum: '$discountAmount' },
            tax: { $sum: '$taxAmount' },
            insurerShare: { $sum: '$insuranceCoveredAmount' },
            patientShare: { $sum: '$patientResponsibleAmount' },
            outstanding: { $sum: '$balance' },
            invoices: { $sum: 1 },
          },
        },
      ]),

      // Note 3 — attribute to the department that raised the charge.
      BillingLineItem.aggregate([
        {
          $match: {
            isActive: true,
            status: 'invoiced',
            chargedAt: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: { department: '$departmentId', source: '$sourceType' },
            amount: { $sum: '$lineTotal' },
            lines: { $sum: 1 },
          },
        },
      ]),

      Invoice.aggregate([
        { $match: invoiceMatch },
        {
          $group: {
            _id: null,
            insurer: { $sum: '$insuranceCoveredAmount' },
            patient: { $sum: '$patientResponsibleAmount' },
          },
        },
      ]),

      // What insurers have actually settled in the range, by insurer.
      Claim.aggregate([
        {
          $match: {
            isActive: true,
            status: 'settled',
            settledAt: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: '$providerId',
            settled: { $sum: '$settledAmount' },
            claimed: { $sum: '$claimedAmount' },
            claims: { $sum: 1 },
          },
        },
        {
          $lookup: {
            // Collection names are the model's own — `insuranceProviders` is
            // camelCase, and a lowercase guess here silently returns no names.
            from: 'insuranceProviders',
            localField: '_id',
            foreignField: '_id',
            as: 'provider',
          },
        },
        { $unwind: { path: '$provider', preserveNullAndEmptyArrays: true } },
      ]),

      Payment.aggregate([
        { $match: { isActive: true, type: 'payment', receivedAt: { $gte: start, $lte: end } } },
        { $group: { _id: '$method', amount: { $sum: '$amount' }, receipts: { $sum: 1 } } },
      ]),
    ]);

  // Merge the two series on their bucket so a day with takings but no new bill
  // (and vice versa) still appears.
  const buckets = new Map();
  for (const row of billedSeries) {
    buckets.set(row._id, { bucket: row._id, billed: round(row.billed), collected: 0, invoices: row.invoices, receipts: 0 });
  }
  for (const row of collectedSeries) {
    const existing = buckets.get(row._id) ?? { bucket: row._id, billed: 0, invoices: 0 };
    existing.collected = round(row.collected);
    existing.receipts = row.receipts;
    buckets.set(row._id, existing);
  }

  const series = [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));

  // Departments are named from a single lookup rather than a $lookup per row.
  const departments = await Department.find({}).select('code name').lean();
  const deptName = new Map(departments.map((d) => [String(d._id), `${d.code} — ${d.name}`]));

  const deptTotals = new Map();
  for (const row of byDepartment) {
    const key = row._id.department ? String(row._id.department) : 'unattributed';
    const entry = deptTotals.get(key) ?? {
      departmentId: row._id.department ?? null,
      department: deptName.get(key) ?? 'Unattributed',
      amount: 0,
      lines: 0,
      bySource: {},
    };
    entry.amount = round(entry.amount + row.amount);
    entry.lines += row.lines;
    entry.bySource[row._id.source] = round((entry.bySource[row._id.source] ?? 0) + row.amount);
    deptTotals.set(key, entry);
  }

  const summary = totals[0] ?? {};
  const payer = byPayer[0] ?? {};

  return {
    series,
    meta: {
      groupBy,
      totals: {
        billed: round(summary.billed ?? 0),
        collected: round(series.reduce((sum, row) => sum + row.collected, 0)),
        discounts: round(summary.discounts ?? 0),
        tax: round(summary.tax ?? 0),
        outstanding: round(summary.outstanding ?? 0),
        invoices: summary.invoices ?? 0,
      },
      byDepartment: [...deptTotals.values()].sort((a, b) => b.amount - a.amount),
      byPayer: {
        insurer: round(payer.insurer ?? 0),
        patient: round(payer.patient ?? 0),
        byInsurer: byInsurer
          .map((row) => ({
            providerId: row._id,
            provider: row.provider?.name ?? 'Unknown insurer',
            claims: row.claims,
            claimed: round(row.claimed),
            settled: round(row.settled),
          }))
          .sort((a, b) => b.settled - a.settled),
      },
      byMethod: byMethod
        .map((row) => ({ method: row._id, amount: round(row.amount), receipts: row.receipts }))
        .sort((a, b) => b.amount - a.amount),
    },
  };
}

// ============================================================ occupancy ====

/**
 * Bed occupancy now, and how long stays are running.
 *
 * See notes 4–5: occupancy is a census, ALOS is a range statistic over
 * *discharged* stays. They are returned together because that is how a bed
 * manager reads them, but they answer different questions.
 */
export async function occupancyReport({ start, end }) {
  const [bedRows, wards, discharged, admissions, currentStays] = await Promise.all([
    Bed.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: { ward: '$wardId', status: '$status' }, count: { $sum: 1 } } },
    ]),

    Ward.find({ isActive: true }).select('code name type departmentId').lean(),

    // Note 4 — only stays that ended inside the range.
    Encounter.aggregate([
      {
        $match: {
          isActive: true,
          'admission.admittedAt': { $ne: null },
          'admission.dischargedAt': { $gte: start, $lte: end },
        },
      },
      {
        $project: {
          wardId: '$admission.wardId',
          dischargeType: '$admission.dischargeType',
          days: {
            $divide: [
              { $subtract: ['$admission.dischargedAt', '$admission.admittedAt'] },
              1000 * 60 * 60 * 24,
            ],
          },
        },
      },
      {
        $group: {
          _id: '$wardId',
          discharges: { $sum: 1 },
          totalDays: { $sum: '$days' },
          longest: { $max: '$days' },
        },
      },
    ]),

    Encounter.countDocuments({
      isActive: true,
      'admission.admittedAt': { $gte: start, $lte: end },
    }),

    Encounter.countDocuments({ isActive: true, status: 'admitted' }),
  ]);

  const wardName = new Map(wards.map((w) => [String(w._id), w]));
  const dischargeByWard = new Map(discharged.map((d) => [String(d._id), d]));

  const rows = new Map();
  for (const row of bedRows) {
    const key = String(row._id.ward);
    const ward = wardName.get(key);
    const entry = rows.get(key) ?? {
      wardId: row._id.ward,
      ward: ward ? `${ward.code} — ${ward.name}` : 'Unknown ward',
      type: ward?.type ?? '—',
      total: 0,
      occupied: 0,
      available: 0,
      unavailable: 0,
    };

    entry.total += row.count;
    if (row._id.status === 'occupied') entry.occupied += row.count;
    else if (row._id.status === 'available') entry.available += row.count;
    // Note 5 — reserved, cleaning and maintenance are all "cannot take a patient".
    else entry.unavailable += row.count;

    rows.set(key, entry);
  }

  const data = [...rows.values()].map((row) => {
    const stay = dischargeByWard.get(String(row.wardId));
    return {
      ...row,
      occupancyRate: row.total > 0 ? round((row.occupied / row.total) * 100) : 0,
      discharges: stay?.discharges ?? 0,
      averageStayDays: stay?.discharges > 0 ? round(stay.totalDays / stay.discharges) : 0,
      longestStayDays: stay?.longest ? round(stay.longest) : 0,
    };
  });

  data.sort((a, b) => b.occupancyRate - a.occupancyRate);

  const totals = data.reduce(
    (acc, row) => {
      acc.total += row.total;
      acc.occupied += row.occupied;
      acc.available += row.available;
      acc.unavailable += row.unavailable;
      acc.discharges += row.discharges;
      return acc;
    },
    { total: 0, occupied: 0, available: 0, unavailable: 0, discharges: 0 },
  );

  const stayDays = discharged.reduce((sum, row) => sum + row.totalDays, 0);
  const stayCount = discharged.reduce((sum, row) => sum + row.discharges, 0);

  return {
    data,
    meta: {
      totals: {
        ...totals,
        occupancyRate: totals.total > 0 ? round((totals.occupied / totals.total) * 100) : 0,
        admissions,
        currentStays,
        averageStayDays: stayCount > 0 ? round(stayDays / stayCount) : 0,
      },
    },
  };
}

// ============================================================ inventory ====

/**
 * What the store consumed, and what is about to be thrown away.
 *
 * Expiry exposure is deliberately a MONEY figure, not a count of batches: three
 * boxes of paracetamol and three vials of a biologic are the same number and
 * very different problems.
 */
export async function inventoryReport({ start, end, expiryDays = 90 }) {
  const expiryCutoff = new Date(end);
  expiryCutoff.setDate(expiryCutoff.getDate() + expiryDays);

  const [burn, lowStock, expiringBatches, stockValue] = await Promise.all([
    InventoryTransaction.aggregate([
      {
        $match: {
          isActive: true,
          type: 'issue',
          occurredAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: '$itemId',
          itemName: { $first: '$itemName' },
          issued: { $sum: '$quantity' },
          value: { $sum: { $abs: '$lineValue' } },
          movements: { $sum: 1 },
        },
      },
      { $sort: { value: -1 } },
    ]),

    InventoryItem.find({
      isActive: true,
      $expr: { $lte: ['$quantityOnHand', '$reorderLevel'] },
    })
      .select('itemCode name category quantityOnHand reorderLevel unit unitCost')
      .lean(),

    DrugBatch.aggregate([
      {
        $match: {
          isActive: true,
          status: 'active',
          quantityOnHand: { $gt: 0 },
          expiryDate: { $lte: expiryCutoff },
        },
      },
      {
        $project: {
          batchNo: 1,
          drugId: 1,
          expiryDate: 1,
          quantityOnHand: 1,
          value: { $multiply: ['$quantityOnHand', '$costPrice'] },
          expired: { $lte: ['$expiryDate', end] },
        },
      },
      { $sort: { expiryDate: 1 } },
      {
        $lookup: { from: 'drugs', localField: 'drugId', foreignField: '_id', as: 'drug' },
      },
      { $unwind: { path: '$drug', preserveNullAndEmptyArrays: true } },
    ]),

    InventoryItem.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: '$category',
          items: { $sum: 1 },
          value: { $sum: { $multiply: ['$quantityOnHand', '$unitCost'] } },
        },
      },
      { $sort: { value: -1 } },
    ]),
  ]);

  const data = burn.map((row) => ({
    itemId: row._id,
    item: row.itemName || '—',
    issued: row.issued,
    value: round(row.value),
    movements: row.movements,
  }));

  const expiring = expiringBatches.map((row) => ({
    batchId: row._id,
    drug: row.drug?.name ?? 'Unknown drug',
    batchNo: row.batchNo,
    expiryDate: row.expiryDate,
    quantityOnHand: row.quantityOnHand,
    value: round(row.value ?? 0),
    /** Already past its date at the end of the range — not merely approaching. */
    expired: Boolean(row.expired),
  }));

  return {
    data,
    meta: {
      totals: {
        burnValue: round(data.reduce((sum, row) => sum + row.value, 0)),
        itemsIssued: data.reduce((sum, row) => sum + row.issued, 0),
        stockValue: round(stockValue.reduce((sum, row) => sum + row.value, 0)),
        lowStockCount: lowStock.length,
        expiryExposure: round(expiring.reduce((sum, row) => sum + row.value, 0)),
        alreadyExpired: round(
          expiring.filter((row) => row.expired).reduce((sum, row) => sum + row.value, 0),
        ),
      },
      expiryDays,
      expiring,
      lowStock: lowStock.map((item) => ({
        itemId: item._id,
        itemCode: item.itemCode,
        item: item.name,
        category: item.category,
        quantityOnHand: item.quantityOnHand,
        reorderLevel: item.reorderLevel,
        unit: item.unit,
      })),
      stockByCategory: stockValue.map((row) => ({
        category: row._id,
        items: row.items,
        value: round(row.value),
      })),
    },
  };
}

// =========================================================== attendance ====

/**
 * Hours worked and overtime across the workforce.
 *
 * Gated on `attendance.view`, not on a reporting grant — see the route. The
 * aggregate is still staff data, and a doctor holding `reports.viewOperational`
 * has no business reading the whole rota's hours.
 */
export async function attendanceReport({ start, end }) {
  const rows = await Attendance.aggregate([
    { $match: { isActive: true, date: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: '$userId',
        present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        leave: { $sum: { $cond: [{ $eq: ['$status', 'leave'] }, 1, 0] } },
        half: { $sum: { $cond: [{ $eq: ['$status', 'half-day'] }, 1, 0] } },
        hours: { $sum: '$hoursWorked' },
        overtime: { $sum: '$overtimeHours' },
        recorded: { $sum: 1 },
        approved: { $sum: { $cond: [{ $ne: ['$approvedBy', null] }, 1, 0] } },
      },
    },
  ]);

  const staff = await User.find({ _id: { $in: rows.map((row) => row._id) } })
    .select('firstName lastName role departmentId')
    .lean();
  const byId = new Map(staff.map((person) => [String(person._id), person]));

  const departments = await Department.find({}).select('code name').lean();
  const deptName = new Map(departments.map((d) => [String(d._id), `${d.code} — ${d.name}`]));

  const data = rows
    .map((row) => {
      const person = byId.get(String(row._id));
      const payableDays = round(
        row.present * PAYABLE_FRACTION.present +
          row.half * PAYABLE_FRACTION['half-day'] +
          row.leave * PAYABLE_FRACTION.leave,
      );

      return {
        userId: row._id,
        name: person ? `${person.firstName} ${person.lastName}`.trim() : 'Unknown',
        role: person?.role ?? '—',
        department: person?.departmentId ? deptName.get(String(person.departmentId)) ?? '—' : '—',
        present: row.present,
        absent: row.absent,
        leave: row.leave,
        half: row.half,
        payableDays,
        hours: round(row.hours),
        overtime: round(row.overtime),
        recorded: row.recorded,
        /** How much of this person's record a supervisor has actually confirmed. */
        approvedPercent: row.recorded > 0 ? round((row.approved / row.recorded) * 100) : 0,
      };
    })
    .sort((a, b) => b.overtime - a.overtime || b.payableDays - a.payableDays);

  const totals = data.reduce(
    (acc, row) => {
      acc.staff += 1;
      acc.hours = round(acc.hours + row.hours);
      acc.overtime = round(acc.overtime + row.overtime);
      acc.absent += row.absent;
      acc.payableDays = round(acc.payableDays + row.payableDays);
      acc.recorded += row.recorded;
      return acc;
    },
    { staff: 0, hours: 0, overtime: 0, absent: 0, payableDays: 0, recorded: 0 },
  );

  return {
    data,
    meta: {
      totals: {
        ...totals,
        /** Overtime as a share of all hours — the number that signals understaffing. */
        overtimeShare: totals.hours > 0 ? round((totals.overtime / totals.hours) * 100) : 0,
        standardShiftHours: STANDARD_SHIFT_HOURS,
      },
    },
  };
}

// ========================================================== departments ====

/**
 * Patient volume, activity and revenue per department.
 *
 * **`revenue` here counts every charge raised — billed or not — while the
 * revenue report counts only invoiced amounts.** That is deliberate and the two
 * figures will not match: this report measures what a department *produced*, and
 * work sitting unbilled in the ledger is still work the department did. The
 * revenue report measures what the hospital *billed*, which is a different
 * question with a different answer. Cancelled charges count in neither.
 */
export async function departmentReport({ start, end }) {
  const range = { $gte: start, $lte: end };

  const [departments, encounters, appointments, charges, beds] = await Promise.all([
    Department.find({ isActive: true }).select('code name').lean(),

    Encounter.aggregate([
      { $match: { isActive: true, startedAt: range } },
      {
        $group: {
          _id: '$departmentId',
          visits: { $sum: 1 },
          admitted: { $sum: { $cond: [{ $ne: ['$admission.admittedAt', null] }, 1, 0] } },
          patients: { $addToSet: '$patientId' },
        },
      },
    ]),

    Appointment.aggregate([
      { $match: { isActive: true, scheduledStart: range } },
      {
        $group: {
          _id: '$departmentId',
          booked: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          noShow: { $sum: { $cond: [{ $eq: ['$status', 'no-show'] }, 1, 0] } },
        },
      },
    ]),

    BillingLineItem.aggregate([
      { $match: { isActive: true, status: { $ne: 'cancelled' }, chargedAt: range } },
      { $group: { _id: '$departmentId', revenue: { $sum: '$lineTotal' } } },
    ]),

    Ward.aggregate([
      { $match: { isActive: true } },
      {
        $lookup: {
          from: 'beds',
          localField: '_id',
          foreignField: 'wardId',
          as: 'beds',
        },
      },
      { $group: { _id: '$departmentId', beds: { $sum: { $size: '$beds' } } } },
    ]),
  ]);

  const index = (rows) => new Map(rows.map((row) => [String(row._id), row]));
  const enc = index(encounters);
  const appt = index(appointments);
  const chg = index(charges);
  const bed = index(beds);

  const data = departments
    .map((department) => {
      const key = String(department._id);
      const visits = enc.get(key);
      const bookings = appt.get(key);
      const revenue = round(chg.get(key)?.revenue ?? 0);
      const bedCount = bed.get(key)?.beds ?? 0;

      return {
        departmentId: department._id,
        code: department.code,
        department: department.name,
        visits: visits?.visits ?? 0,
        uniquePatients: visits?.patients?.length ?? 0,
        admissions: visits?.admitted ?? 0,
        booked: bookings?.booked ?? 0,
        completed: bookings?.completed ?? 0,
        noShow: bookings?.noShow ?? 0,
        noShowRate:
          bookings?.booked > 0 ? round((bookings.noShow / bookings.booked) * 100) : 0,
        revenue,
        beds: bedCount,
        /** Only meaningful where a department has beds; 0 elsewhere, not null. */
        revenuePerBed: bedCount > 0 ? round(revenue / bedCount) : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  return {
    data,
    meta: {
      totals: {
        departments: data.length,
        visits: data.reduce((sum, row) => sum + row.visits, 0),
        admissions: data.reduce((sum, row) => sum + row.admissions, 0),
        revenue: round(data.reduce((sum, row) => sum + row.revenue, 0)),
        booked: data.reduce((sum, row) => sum + row.booked, 0),
        noShow: data.reduce((sum, row) => sum + row.noShow, 0),
      },
    },
  };
}

// ============================================================= clinical ====

/**
 * Diagnostics throughput and turnaround.
 *
 * See note 6: turnaround is `ordered → completed` in hours, averaged over orders
 * that actually completed inside the range. Orders still open are counted as
 * pending, not as a very long turnaround.
 */
export async function clinicalReport({ start, end }) {
  const range = { $gte: start, $lte: end };

  const turnaroundStage = (collection) => [
    { $match: { isActive: true, status: 'completed', completedAt: range } },
    {
      $project: {
        priority: 1,
        hours: {
          $divide: [{ $subtract: ['$completedAt', '$createdAt'] }, 1000 * 60 * 60],
        },
      },
    },
    {
      $group: {
        _id: '$priority',
        completed: { $sum: 1 },
        totalHours: { $sum: '$hours' },
        slowest: { $max: '$hours' },
      },
    },
    { $addFields: { service: collection } },
  ];

  const [labTurnaround, radTurnaround, labPending, radPending, admissionOutcomes, topDiagnoses] =
    await Promise.all([
      LabOrder.aggregate(turnaroundStage('laboratory')),
      RadiologyOrder.aggregate(turnaroundStage('radiology')),

      LabOrder.countDocuments({ isActive: true, status: { $in: LAB_PENDING } }),
      RadiologyOrder.countDocuments({ isActive: true, status: { $in: RADIOLOGY_PENDING } }),

      Encounter.aggregate([
        {
          $match: {
            isActive: true,
            'admission.dischargedAt': range,
            'admission.dischargeType': { $ne: null },
          },
        },
        { $group: { _id: '$admission.dischargeType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Encounter.aggregate([
        { $match: { isActive: true, startedAt: range, 'diagnosis.0': { $exists: true } } },
        { $unwind: '$diagnosis' },
        { $match: { 'diagnosis.type': 'primary' } },
        {
          $group: {
            _id: { $toLower: '$diagnosis.description' },
            count: { $sum: 1 },
            label: { $first: '$diagnosis.description' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

  const data = [...labTurnaround, ...radTurnaround]
    .map((row) => ({
      service: row.service,
      priority: row._id ?? 'routine',
      completed: row.completed,
      averageHours: row.completed > 0 ? round(row.totalHours / row.completed) : 0,
      slowestHours: round(row.slowest ?? 0),
    }))
    .sort((a, b) => a.service.localeCompare(b.service) || b.completed - a.completed);

  const completedTotal = data.reduce((sum, row) => sum + row.completed, 0);
  const weightedHours = data.reduce((sum, row) => sum + row.averageHours * row.completed, 0);

  return {
    data,
    meta: {
      totals: {
        completed: completedTotal,
        averageHours: completedTotal > 0 ? round(weightedHours / completedTotal) : 0,
        pending: labPending + radPending,
        labPending,
        radiologyPending: radPending,
      },
      dischargeOutcomes: admissionOutcomes.map((row) => ({ outcome: row._id, count: row.count })),
      topDiagnoses: topDiagnoses.map((row) => ({ diagnosis: row.label, count: row.count })),
    },
  };
}

// ============================================================ dashboard ====

/** Midnight-to-now, for the "today" figures. */
function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return { start, end: new Date() };
}

/**
 * Compose the dashboard for one caller.
 *
 * Each section is computed ONLY if the caller holds the matching grant — the
 * permission check wraps the query, so an unentitled caller does not merely have
 * a section hidden from them, the data is never read. `can` is injected rather
 * than imported so this stays a pure function of its inputs and is testable
 * without a request.
 */
export async function dashboardSummary({ can }) {
  const { start: dayStart, end: now } = todayRange();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  const sections = {};

  if (can('reports', 'viewOperational')) {
    const [openVisits, admitted, bedRows, todayAppointments, todayVisits, todayAdmissions, todayDischarges] =
      await Promise.all([
        Encounter.countDocuments({ isActive: true, status: 'open' }),
        Encounter.countDocuments({ isActive: true, status: 'admitted' }),
        Bed.aggregate([
          { $match: { isActive: true } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        Appointment.countDocuments({
          isActive: true,
          scheduledStart: { $gte: dayStart, $lte: new Date(dayStart.getTime() + 86399999) },
        }),
        Encounter.countDocuments({ isActive: true, startedAt: { $gte: dayStart, $lte: now } }),
        Encounter.countDocuments({
          isActive: true,
          'admission.admittedAt': { $gte: dayStart, $lte: now },
        }),
        Encounter.countDocuments({
          isActive: true,
          'admission.dischargedAt': { $gte: dayStart, $lte: now },
        }),
      ]);

    const beds = bedRows.reduce(
      (acc, row) => {
        acc.total += row.count;
        if (row._id === 'occupied') acc.occupied += row.count;
        else if (row._id === 'available') acc.available += row.count;
        else acc.unavailable += row.count;
        return acc;
      },
      { total: 0, occupied: 0, available: 0, unavailable: 0 },
    );

    sections.operational = {
      openVisits,
      admitted,
      beds: {
        ...beds,
        occupancyRate: beds.total > 0 ? round((beds.occupied / beds.total) * 100) : 0,
      },
      today: {
        appointments: todayAppointments,
        visits: todayVisits,
        admissions: todayAdmissions,
        discharges: todayDischarges,
      },
    };
  }

  if (can('reports', 'viewFinancial')) {
    const [todayBilled, monthBilled, todayCollected, monthCollected, outstanding, unbilled] =
      await Promise.all([
        Invoice.aggregate([
          { $match: { isActive: true, status: { $ne: 'void' }, issuedAt: { $gte: dayStart, $lte: now } } },
          { $group: { _id: null, amount: { $sum: '$total' }, count: { $sum: 1 } } },
        ]),
        Invoice.aggregate([
          { $match: { isActive: true, status: { $ne: 'void' }, issuedAt: { $gte: monthStart, $lte: now } } },
          { $group: { _id: null, amount: { $sum: '$total' }, count: { $sum: 1 } } },
        ]),
        Payment.aggregate([
          { $match: { isActive: true, receivedAt: { $gte: dayStart, $lte: now } } },
          { $group: { _id: null, amount: { $sum: '$amount' } } },
        ]),
        Payment.aggregate([
          { $match: { isActive: true, receivedAt: { $gte: monthStart, $lte: now } } },
          { $group: { _id: null, amount: { $sum: '$amount' } } },
        ]),
        Invoice.aggregate([
          { $match: { isActive: true, status: { $in: ['issued', 'partially-paid'] } } },
          { $group: { _id: null, amount: { $sum: '$balance' }, count: { $sum: 1 } } },
        ]),
        // Work done but never billed — the leak that outstanding balances miss.
        BillingLineItem.aggregate([
          { $match: { isActive: true, status: 'unbilled' } },
          { $group: { _id: null, amount: { $sum: '$lineTotal' }, count: { $sum: 1 } } },
        ]),
      ]);

    const first = (rows) => rows[0] ?? {};

    sections.financial = {
      today: {
        billed: round(first(todayBilled).amount ?? 0),
        collected: round(first(todayCollected).amount ?? 0),
        invoices: first(todayBilled).count ?? 0,
      },
      month: {
        billed: round(first(monthBilled).amount ?? 0),
        collected: round(first(monthCollected).amount ?? 0),
        invoices: first(monthBilled).count ?? 0,
      },
      outstanding: {
        amount: round(first(outstanding).amount ?? 0),
        invoices: first(outstanding).count ?? 0,
      },
      unbilled: {
        amount: round(first(unbilled).amount ?? 0),
        charges: first(unbilled).count ?? 0,
      },
    };
  }

  if (can('reports', 'viewClinical')) {
    const [labPending, radPending, criticalResults, visitsToday] = await Promise.all([
      LabOrder.countDocuments({ isActive: true, status: { $in: LAB_PENDING } }),
      RadiologyOrder.countDocuments({ isActive: true, status: { $in: RADIOLOGY_PENDING } }),
      // Critical findings are the one number worth interrupting someone for.
      LabResult.countDocuments({ isActive: true, hasCriticalValues: true, status: 'verified' }),
      Encounter.countDocuments({ isActive: true, startedAt: { $gte: dayStart, $lte: now } }),
    ]);

    sections.clinical = {
      labPending,
      radiologyPending: radPending,
      criticalResults,
      visitsToday,
    };
  }

  if (can('attendance', 'view')) {
    const [onDutyToday, unapproved] = await Promise.all([
      Attendance.countDocuments({
        isActive: true,
        date: { $gte: dayStart, $lte: new Date(dayStart.getTime() + 86399999) },
        status: 'present',
      }),
      Attendance.countDocuments({ isActive: true, approvedBy: null }),
    ]);

    sections.workforce = { onDutyToday, unapprovedRecords: unapproved };
  }

  return {
    sections,
    available: Object.keys(sections),
    generatedAt: now,
  };
}

/** Registered patients — cheap, and every dashboard variant wants it. */
export async function patientCount() {
  return Patient.countDocuments({ isActive: true });
}

export default {
  resolveRange,
  revenueReport,
  occupancyReport,
  inventoryReport,
  attendanceReport,
  departmentReport,
  clinicalReport,
  dashboardSummary,
};
