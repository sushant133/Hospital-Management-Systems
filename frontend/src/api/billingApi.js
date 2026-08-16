import { api } from './client.js';

export const billingApi = {
  // The shared charge ledger
  listLineItems: (params) => api.get('/billing/line-items', { params }),
  createLineItem: (payload) => api.post('/billing/line-items', payload),
  cancelLineItem: (id, payload) => api.post(`/billing/line-items/${id}/cancel`, payload ?? {}),
  outstanding: (params) => api.get('/billing/reports/outstanding', { params }),

  // Invoices
  previewInvoice: (encounterId) => api.get('/invoices/preview', { params: { encounterId } }),
  listInvoices: (params) => api.get('/invoices', { params }),
  getInvoice: (id) => api.get(`/invoices/${id}`),
  createInvoice: (payload) => api.post('/invoices', payload),
  issueInvoice: (id, payload) => api.post(`/invoices/${id}/issue`, payload ?? {}),
  syncCharges: (id) => api.post(`/invoices/${id}/charges`, {}),
  voidInvoice: (id, payload) => api.post(`/invoices/${id}/void`, payload),
  deleteInvoice: (id) => api.delete(`/invoices/${id}`),

  // Discount — requested by one person, authorised by another
  requestDiscount: (id, payload) => api.post(`/invoices/${id}/discount`, payload),
  decideDiscount: (id, payload) => api.post(`/invoices/${id}/discount/decision`, payload),

  // Money
  recordPayment: (id, payload) => api.post(`/invoices/${id}/payments`, payload),
  recordRefund: (id, payload) => api.post(`/invoices/${id}/refunds`, payload),
  listPayments: (params) => api.get('/payments', { params }),

  /** Opened in a new tab; the session cookie authenticates the request. */
  receiptUrl: (id) => `/api/v1/invoices/${id}/receipt`,
};

export const INVOICE_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'issued', label: 'Issued' },
  { value: 'partially-paid', label: 'Partially paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];

export const INVOICE_STATUS_TONES = {
  draft: 'neutral',
  issued: 'info',
  'partially-paid': 'warning',
  paid: 'success',
  void: 'danger',
};

export const PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'wallet', label: 'Mobile wallet' },
  { value: 'insurance', label: 'Insurer payment' },
];

export const PAYMENT_TYPE_TONES = {
  payment: 'success',
  refund: 'warning',
  'credit-note': 'purple',
};

export const DISCOUNT_STATUS_TONES = {
  none: 'neutral',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

export const BUCKET_TONES = {
  '0-30': 'success',
  '31-60': 'info',
  '61-90': 'warning',
  '90+': 'danger',
};

/**
 * What the desk can do next, mirroring the server's transition table so the UI
 * never offers an action the API will reject.
 */
export function invoiceActions(status) {
  return (
    {
      draft: ['issue', 'void'],
      issued: ['pay', 'void'],
      'partially-paid': ['pay', 'refund', 'void'],
      paid: ['refund'],
      void: [],
    }[status] ?? []
  );
}

export default billingApi;
