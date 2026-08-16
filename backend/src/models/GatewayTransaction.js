import mongoose from 'mongoose';
import auditable from './plugins/auditable.js';
import { nextFormattedId } from '../utils/sequence.js';

const { Schema } = mongoose;

/** The domestic wallets and rails a Nepali hospital counter actually sees. */
export const GATEWAY_PROVIDERS = Object.freeze({
  ESEWA: 'esewa',
  KHALTI: 'khalti',
  FONEPAY: 'fonepay', // NepalPay QR
  CONNECTIPS: 'connectips',
  IME_PAY: 'imepay',
});

export const GATEWAY_PROVIDER_VALUES = Object.freeze(Object.values(GATEWAY_PROVIDERS));

export const GATEWAY_TXN_STATUSES = Object.freeze([
  'initiated', // we have created it; the patient has not paid yet
  'pending', // patient is at the wallet, or the QR is displayed
  'succeeded',
  'failed',
  'expired',
  'refunded',
  'reconciled', // matched against the provider's settlement file
]);

/**
 * ============================================================================
 * ONE ATTEMPT TO COLLECT MONEY THROUGH A GATEWAY
 * ============================================================================
 *
 * Deliberately a separate collection from `Payment`.
 *
 * A `Payment` is a fact in the hospital's ledger: money received. A gateway
 * transaction is an *attempt*, and most of the interesting states are ones
 * where no money moved — initiated and abandoned, expired, failed, or worst,
 * "the wallet says it succeeded and we never heard about it". Modelling
 * attempts as payments would put phantom money in the ledger; modelling them
 * as nothing at all leaves the cashier unable to answer "the patient says they
 * paid on eSewa, where is it?".
 *
 * So: a transaction succeeds → we write a `Payment` and link it here. One
 * payment, one transaction, and `paymentId` is what proves it was only counted
 * once.
 */
const gatewayTransactionSchema = new Schema(
  {
    reference: { type: String, unique: true, index: true },

    provider: { type: String, enum: GATEWAY_PROVIDER_VALUES, required: true, index: true },

    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },

    amount: { type: Number, required: true, min: 0 },

    status: { type: String, enum: GATEWAY_TXN_STATUSES, default: 'initiated', index: true },

    /** The provider's own transaction identifier, once they give us one. */
    providerTransactionId: { type: String, trim: true, default: '', index: true },
    /** What the patient's wallet shows them — quoted back at the counter. */
    providerReference: { type: String, trim: true, default: '' },

    /** The dynamic QR payload, when this is a counter QR collection. */
    qrPayload: { type: String, default: '' },
    /** The URL the patient was sent to, for redirect-style gateways. */
    checkoutUrl: { type: String, default: '' },

    initiatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    initiatedAt: { type: Date, default: Date.now },
    /** Gateways time out; an expired attempt must not be settled later. */
    expiresAt: { type: Date, default: null, index: true },

    completedAt: { type: Date, default: null },
    failureReason: { type: String, trim: true, default: '' },

    /**
     * The ledger entry this produced. Set exactly once, and its presence is
     * what makes webhook handling idempotent — a gateway that delivers the
     * same callback three times must not create three payments.
     */
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },

    /** Every callback and verification response, for dispute resolution. */
    providerEvents: {
      type: [
        new Schema(
          {
            at: { type: Date, default: Date.now },
            kind: { type: String, trim: true },
            payload: { type: Schema.Types.Mixed },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    // --- Settlement reconciliation ---
    /**
     * Matched against the provider's daily settlement file. This is where money
     * actually goes missing: a wallet reports success, the hospital records a
     * payment, and the money never lands. Nothing else in the system will
     * notice, so the reconciliation report is not optional.
     */
    reconciledAt: { type: Date, default: null },
    settlementReference: { type: String, trim: true, default: '' },
    settledAmount: { type: Number, default: null },
    /** Provider commission, so net-vs-gross is visible in the revenue report. */
    feeAmount: { type: Number, default: 0, min: 0 },

    refundedAt: { type: Date, default: null },
    refundReference: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'gatewayTransactions',
    toJSON: { virtuals: true, transform: (_d, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  },
);

gatewayTransactionSchema.plugin(auditable);

gatewayTransactionSchema.index({ status: 1, initiatedAt: -1 });
gatewayTransactionSchema.index({ provider: 1, reconciledAt: 1 });
// One in-flight attempt per invoice per provider, so a patient double-clicking
// "Pay with eSewa" does not open two collections against the same bill.
gatewayTransactionSchema.index(
  { invoiceId: 1, provider: 1, status: 1 },
  { partialFilterExpression: { status: { $in: ['initiated', 'pending'] } } },
);

gatewayTransactionSchema.pre('save', async function assignReference(next) {
  if (this.isNew && !this.reference) {
    this.reference = await nextFormattedId('gatewayTxn', 'GTX', 8);
  }
  next();
});

/** Succeeded but never matched to a settlement — the money-missing worklist. */
gatewayTransactionSchema.virtual('awaitingSettlement').get(function awaiting() {
  return this.status === 'succeeded' && !this.reconciledAt;
});

export const GatewayTransaction = mongoose.model('GatewayTransaction', gatewayTransactionSchema);
export default GatewayTransaction;
