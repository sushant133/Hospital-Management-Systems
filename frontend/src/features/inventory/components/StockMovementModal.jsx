import { useEffect, useState } from 'react';
import {
  inventoryApi,
  TRANSACTION_TYPE_OPTIONS,
  DEPARTMENT_TYPES,
} from '../../../api/inventoryApi.js';
import { departmentsApi } from '../../../api/departmentApi.js';
import { Alert, Button, Input, Modal, Select, Textarea } from '../../../components/ui/index.js';

const EMPTY = {
  type: 'receipt',
  quantity: '',
  direction: 'decrease',
  departmentId: '',
  reference: '',
  reason: '',
};

/**
 * Record a stock movement.
 *
 * One form for all four types, because they are the same act — moving stock and
 * writing it down — differing only in direction and what each requires
 * alongside. The fields appear as the type demands them rather than being shown
 * greyed out.
 */
export function StockMovementModal({ open, item, onClose, onDone }) {
  const [form, setForm] = useState(EMPTY);
  const [departments, setDepartments] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    setForm(EMPTY);
    setError(null);

    let cancelled = false;
    (async () => {
      try {
        const response = await departmentsApi.list({ limit: 100 });
        if (!cancelled) setDepartments(response.data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const needsDepartment = DEPARTMENT_TYPES.includes(form.type);
  const isAdjustment = form.type === 'adjustment';

  const submit = async () => {
    setError(null);

    if (!form.quantity || Number(form.quantity) < 1) return setError('Enter a quantity of at least 1.');
    if (needsDepartment && !form.departmentId) {
      return setError('Name the department the stock is going to or coming back from.');
    }
    if (isAdjustment && form.reason.trim().length < 5) {
      return setError('An adjustment needs a reason of at least 5 characters.');
    }

    setSaving(true);
    try {
      const response = await inventoryApi.recordTransaction({
        itemId: item._id,
        type: form.type,
        quantity: Number(form.quantity),
        direction: isAdjustment ? form.direction : undefined,
        departmentId: needsDepartment ? form.departmentId : undefined,
        reference: form.reference.trim() || undefined,
        reason: form.reason.trim() || undefined,
      });
      onDone?.(response);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open || !item) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record stock movement"
      description={`${item.name} · ${item.quantityOnHand} ${item.unit}(s) on hand`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={submit}>Record movement</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

        <Select
          label="Movement"
          options={TRANSACTION_TYPE_OPTIONS}
          value={form.type}
          onChange={set('type')}
        />

        <Input
          label="Quantity"
          type="number"
          min="1"
          required
          value={form.quantity}
          onChange={set('quantity')}
          hint={`Counted in ${item.unit}(s)`}
        />

        {isAdjustment && (
          <Select
            label="Direction"
            options={[
              { value: 'decrease', label: 'Decrease — stock is less than recorded' },
              { value: 'increase', label: 'Increase — stock is more than recorded' },
            ]}
            value={form.direction}
            onChange={set('direction')}
          />
        )}

        {needsDepartment && (
          <Select
            label={form.type === 'issue' ? 'Issue to' : 'Returned from'}
            placeholder="Select a department"
            required
            value={form.departmentId}
            onChange={set('departmentId')}
            options={departments.map((dept) => ({ value: dept._id, label: dept.name }))}
          />
        )}

        <Input
          label="Reference"
          value={form.reference}
          onChange={set('reference')}
          placeholder={form.type === 'receipt' ? 'PO-4471' : 'REQ-001'}
        />

        {isAdjustment && (
          <Textarea
            label="Reason"
            required
            rows={2}
            hint="Stock that changes without a stated reason cannot be reconciled."
            value={form.reason}
            onChange={set('reason')}
            placeholder="Stock count: three boxes water damaged and destroyed"
          />
        )}
      </div>
    </Modal>
  );
}

export default StockMovementModal;
