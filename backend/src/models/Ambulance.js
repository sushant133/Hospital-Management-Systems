import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';
import { DISTRICT_CODES } from '../utils/nepal.js';

const { Schema } = mongoose;

export const VEHICLE_TYPES = Object.freeze(['basic', 'advanced-life-support', 'neonatal', 'mortuary', 'transport']);
export const VEHICLE_STATUSES = Object.freeze(['available', 'dispatched', 'maintenance', 'out-of-service']);

export const TRIP_TYPES = Object.freeze([
  'emergency-pickup',
  'inter-facility-referral',
  'discharge-home',
  'body-transport',
  'planned-transfer',
]);

export const TRIP_STATUSES = Object.freeze([
  'requested',
  'dispatched',
  'at-scene',
  'transporting',
  'completed',
  'cancelled',
  'aborted',
]);

/**
 * ============================================================================
 * AMBULANCE AND PATIENT TRANSPORT (C3)
 * ============================================================================
 *
 * A fleet, a dispatch log, and a billable trip record.
 *
 * Also the point where the Aama Surakshya transport incentive is earned: a
 * mother delivering institutionally is entitled to a cash transport payment
 * (see A7), and without a trip record there is nothing to claim it against.
 * `schemeClaimId` links the two rather than leaving the money on the table.
 */
const ambulanceSchema = new Schema(
  {
    vehicleNumber: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    callSign: { type: String, trim: true, default: '' },
    vehicleType: { type: String, enum: VEHICLE_TYPES, default: 'basic', index: true },

    make: { type: String, trim: true, default: '' },
    model: { type: String, trim: true, default: '' },
    yearOfManufacture: { type: Number, default: null },

    status: { type: String, enum: VEHICLE_STATUSES, default: 'available', index: true },
    baseLocation: { type: String, trim: true, default: '' },

    /** Kit on board, so dispatch can match the vehicle to the case. */
    hasOxygen: { type: Boolean, default: true },
    hasSuction: { type: Boolean, default: false },
    hasDefibrillator: { type: Boolean, default: false },
    hasVentilator: { type: Boolean, default: false },
    stretcherCount: { type: Number, default: 1, min: 0 },

    /** Compliance dates that take a vehicle off the road when they lapse. */
    insuranceExpiry: { type: Date, default: null },
    roadPermitExpiry: { type: Date, default: null },
    fitnessExpiry: { type: Date, default: null },

    currentOdometerKm: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'ambulances',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

ambulanceSchema.plugin(auditable);
ambulanceSchema.index({ status: 1, vehicleType: 1 });

/**
 * A vehicle whose paperwork has lapsed is not roadworthy.
 *
 * Surfaced rather than enforced: refusing to dispatch an ambulance because its
 * insurance expired yesterday would, in an emergency, be the wrong call. The
 * dispatcher is told and decides.
 */
ambulanceSchema.virtual('complianceIssues').get(function issues() {
  const now = new Date();
  const problems = [];
  if (this.insuranceExpiry && new Date(this.insuranceExpiry) < now) problems.push('insurance expired');
  if (this.roadPermitExpiry && new Date(this.roadPermitExpiry) < now) problems.push('road permit expired');
  if (this.fitnessExpiry && new Date(this.fitnessExpiry) < now) problems.push('fitness certificate expired');
  return problems;
});

export const Ambulance = mongoose.model('Ambulance', ambulanceSchema);

const ambulanceTripSchema = new Schema(
  {
    tripNumber: { type: String, unique: true, index: true },

    ambulanceId: { type: Schema.Types.ObjectId, ref: 'Ambulance', required: true, index: true },
    vehicleNumber: { type: String, trim: true, default: '' },

    tripType: { type: String, enum: TRIP_TYPES, required: true, index: true },
    status: { type: String, enum: TRIP_STATUSES, default: 'requested', index: true },

    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null, index: true },
    encounterId: { type: Schema.Types.ObjectId, ref: 'Encounter', default: null },
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', default: null },

    // --- Where -------------------------------------------------------------
    fromLocation: { type: String, required: true, trim: true },
    fromDistrict: { type: String, enum: [...DISTRICT_CODES, ''], default: '' },
    toLocation: { type: String, required: true, trim: true },
    toDistrict: { type: String, enum: [...DISTRICT_CODES, ''], default: '' },

    // --- When. Each stamp is a real dispatch milestone, not decoration:
    // the gaps between them are the response-time measures a district health
    // office asks for.
    requestedAt: { type: Date, default: Date.now, required: true, index: true },
    dispatchedAt: { type: Date, default: null },
    arrivedAtSceneAt: { type: Date, default: null },
    departedSceneAt: { type: Date, default: null },
    arrivedAtDestinationAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    // --- Who ---------------------------------------------------------------
    driverId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    driverName: { type: String, trim: true, default: '' },
    attendantIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },

    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    callerName: { type: String, trim: true, default: '' },
    callerPhone: { type: String, trim: true, default: '' },

    // --- Distance and cost --------------------------------------------------
    odometerStartKm: { type: Number, default: null, min: 0 },
    odometerEndKm: { type: Number, default: null, min: 0 },
    distanceKm: { type: Number, default: null, min: 0 },

    /** Charged to the patient, unless a scheme bears it. */
    chargeAmount: { type: Number, default: 0, min: 0 },
    billingLineItemId: { type: Schema.Types.ObjectId, ref: 'BillingLineItem', default: null },
    /** The Aama Surakshya transport incentive, where this trip earns one. */
    schemeClaimId: { type: Schema.Types.ObjectId, ref: 'SchemeClaim', default: null },

    /** Care given en route — this is a clinical record, not just a taxi log. */
    clinicalNotes: { type: String, trim: true, default: '' },
    oxygenUsedLitres: { type: Number, default: null, min: 0 },

    cancelReason: { type: String, trim: true, default: '' },
    abortReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'ambulanceTrips',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

ambulanceTripSchema.plugin(auditable);
ambulanceTripSchema.index({ status: 1, requestedAt: -1 });
ambulanceTripSchema.index({ ambulanceId: 1, requestedAt: -1 });
ambulanceTripSchema.index({ patientId: 1, requestedAt: -1 });

ambulanceTripSchema.pre('save', async function assignNumber(next) {
  if (this.isNew && !this.tripNumber) {
    this.tripNumber = await nextFormattedId('ambulanceTrip', 'AMB', 6);
  }
  // Distance from the odometer when both ends are recorded — a typed distance
  // is a guess, and the odometer is the thing fuel reconciliation uses.
  if (this.odometerStartKm != null && this.odometerEndKm != null) {
    this.distanceKm = Math.max(0, this.odometerEndKm - this.odometerStartKm);
  }
  next();
});

/** Minutes from request to wheels rolling — the number that gets audited. */
ambulanceTripSchema.virtual('responseMinutes').get(function response() {
  if (!this.dispatchedAt) return null;
  return Math.round((new Date(this.dispatchedAt) - new Date(this.requestedAt)) / 60000);
});

/** Minutes from request to reaching the patient. */
ambulanceTripSchema.virtual('sceneArrivalMinutes').get(function arrival() {
  if (!this.arrivedAtSceneAt) return null;
  return Math.round((new Date(this.arrivedAtSceneAt) - new Date(this.requestedAt)) / 60000);
});

export const AmbulanceTrip = mongoose.model('AmbulanceTrip', ambulanceTripSchema);

export default { Ambulance, AmbulanceTrip };
