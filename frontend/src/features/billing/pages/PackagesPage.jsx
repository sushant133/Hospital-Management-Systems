import { useCallback, useEffect, useState } from 'react';
import { packageApi } from '../../../api/packageApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import {
  Alert, Badge, Button, Input, Modal, PageHeader, Spinner,
  Table, TBody, TD, THead, TR, TRMessage, Textarea,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Package' },
  { key: 'items', label: 'Items' },
  { key: 'total', label: 'Total (incl. tax)' },
];

const EMPTY_ITEM = { itemCode: '', description: '', quantity: 1, unitPrice: 0, taxPercent: 0, sourceType: 'procedure' };

export function PackagesPage() {
  const { can } = useAuth();
  const canCreate = can(MODULES.BILLING_PACKAGES, 'create');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', description: '', items: [{ ...EMPTY_ITEM }] });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await packageApi.list({ limit: 100 });
      setRows(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setItem = (index, key, value) => {
    setForm((prev) => {
      const items = prev.items.map((item, i) => (i === index ? { ...item, [key]: value } : item));
      return { ...prev, items };
    });
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) return setFormError('Code and name are required.');
    if (form.items.some((item) => !item.itemCode || !item.description)) {
      return setFormError('Every item needs a code and description.');
    }
    setSaving(true);
    setFormError(null);
    try {
      const response = await packageApi.create({
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        items: form.items.map((item) => ({
          ...item,
          quantity: Number(item.quantity || 1),
          unitPrice: Number(item.unitPrice || 0),
          taxPercent: Number(item.taxPercent || 0),
        })),
      });
      setNotice(response.message);
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Billing packages"
        description="Bundled charges (consultation packs, OT packages) applied to a visit in one step."
        action={canCreate && (
          <Button onClick={() => {
            setForm({ code: '', name: '', description: '', items: [{ ...EMPTY_ITEM }] });
            setFormError(null);
            setOpen(true);
          }}
          >
            New package
          </Button>
        )}
      />

      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      {loading ? <Spinner label="Loading packages…" className="py-12" /> : (
        <Table>
          <THead columns={COLUMNS} />
          <TBody>
            {rows.length === 0 && <TRMessage colSpan={COLUMNS.length}>No packages yet.</TRMessage>}
            {rows.map((pkg) => (
              <TR key={pkg._id}>
                <TD><Badge tone="neutral">{pkg.code}</Badge></TD>
                <TD>
                  <div className="font-medium text-slate-900">{pkg.name}</div>
                  <div className="text-xs text-slate-500">{pkg.description}</div>
                </TD>
                <TD>{pkg.items?.length ?? 0}</TD>
                <TD>{Number(pkg.packageTotal ?? 0).toFixed(2)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New billing package"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={save}>Create</Button>
          </>
        }
      >
        {formError && <Alert tone="error" className="mb-3">{formError}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Code" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} />
          <Input label="Name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          <Textarea className="sm:col-span-2" label="Description" rows={2} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
        </div>
        <div className="mt-4 space-y-3">
          {form.items.map((item, index) => (
            <div key={index} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-5">
              <Input label="Item code" value={item.itemCode} onChange={(e) => setItem(index, 'itemCode', e.target.value)} />
              <Input className="sm:col-span-2" label="Description" value={item.description} onChange={(e) => setItem(index, 'description', e.target.value)} />
              <Input label="Price" type="number" value={item.unitPrice} onChange={(e) => setItem(index, 'unitPrice', e.target.value)} />
              <Input label="Tax %" type="number" value={item.taxPercent} onChange={(e) => setItem(index, 'taxPercent', e.target.value)} />
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() => setForm((p) => ({ ...p, items: [...p.items, { ...EMPTY_ITEM }] }))}
          >
            Add line
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export default PackagesPage;
