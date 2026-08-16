import { api } from './client.js';

export const inventoryApi = {
  listItems: (params) => api.get('/inventory/items', { params }),
  getItem: (id) => api.get(`/inventory/items/${id}`),
  createItem: (payload) => api.post('/inventory/items', payload),
  updateItem: (id, payload) => api.patch(`/inventory/items/${id}`, payload),
  retireItem: (id) => api.delete(`/inventory/items/${id}`),

  listTransactions: (params) => api.get('/inventory/transactions', { params }),
  recordTransaction: (payload) => api.post('/inventory/transactions', payload),

  alerts: () => api.get('/inventory/alerts'),
  consumption: (params) => api.get('/inventory/consumption', { params }),
};

export const CATEGORY_OPTIONS = [
  'consumable', 'ppe', 'surgical', 'linen', 'stationery',
  'equipment', 'furniture', 'maintenance', 'other',
].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));

export const TRANSACTION_TYPE_OPTIONS = [
  { value: 'receipt', label: 'Receipt — stock in' },
  { value: 'issue', label: 'Issue — to a department' },
  { value: 'return', label: 'Return — back from a department' },
  { value: 'adjustment', label: 'Adjustment — correct a count' },
];

export const TRANSACTION_TONES = {
  receipt: 'success',
  issue: 'info',
  return: 'purple',
  adjustment: 'warning',
};

/** Movements that need a department named. */
export const DEPARTMENT_TYPES = ['issue', 'return'];

export default inventoryApi;
