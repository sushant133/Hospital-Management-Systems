import { useCallback, useEffect, useState } from 'react';
import { labApi, SPECIMEN_OPTIONS } from './labApi.js';
import { departmentsApi } from '../departments/departmentsApi.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { MODULES } from '../../app/permissions.js';
import {
  Alert, Badge, Button, Input, Modal, PageHeader, Pagination, Select,
  Table, TBody, TD, THead, TR, TRMessage, Textarea,
} from '../../components/ui/index.js';

const COLUMNS = [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Test' },
  { key: 'dept', label: 'Department' },
  { key: 'specimen', label: 'Specimen' },
  { key: 'analytes', label: 'Analytes' },
  { key: 'price', label: 'Price', align: 'right' },
  { key: 'actions', label: '', align: 'right' },
];

const BLANK_ANALYTE = {
  code: '', name: '', valueType: 'numeric', unit: '',
  refLow: '', refHigh: '', criticalLow: '', criticalHigh: '', normalValue: '',
};

const BLANK = {
  code: '', name: '', description: '', departmentId: '', specimen: 'blood',
  category: '', price: '', turnaroundHours: '24', preparationNotes: '',
  analytes: [{ ...BLANK_ANALYTE }],
};

/** '' -> null so the API's nullable numbers accept it. */
function numOrNull(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : Number(trimmed);
}

export function LabCatalogPage() {
  const { can } = useAuth();
  const canManage = can(MODULES.LAB_TESTS, 'edit');

  const [tests, setTests] = useState([]);
  const [meta, setMeta] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [fieldErrors, setFieldErrors] = useState({});
  const [modalError, setModalError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(search); setPage(1); }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    departmentsApi
      .list({ limit: 100, sort: 'name' })
      .then((r) => setDepartments(r.data))
      .catch(() => setDepartments([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await labApi.listTests({ page, limit: 20, search: debounced || undefined });
      setTests(response.data);
      setMeta(response.meta);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, debounced]);

  useEffect(() => { load(); }, [load]);

  const departmentOptions = departments.map((d) => ({ value: d._id, label: `${d.code} — ${d.name}` }));

  const openCreate = () => {
    setForm({ ...BLANK, analytes: [{ ...BLANK_ANALYTE }] });
    setFieldErrors({});
    setModalError(null);
    setEditing({});
  };

  const openEdit = (test) => {
    setForm({
      code: test.code ?? '',
      name: test.name ?? '',
      description: test.description ?? '',
      departmentId: test.departmentId?._id ?? test.departmentId ?? '',
      specimen: test.specimen ?? 'blood',
      category: test.category ?? '',
      price: String(test.price ?? ''),
      turnaroundHours: String(test.turnaroundHours ?? '24'),
      preparationNotes: test.preparationNotes ?? '',
      analytes: (test.analytes ?? []).map((a) => ({
        code: a.code ?? '',
        name: a.name ?? '',
        valueType: a.valueType ?? 'numeric',
        unit: a.unit ?? '',
        refLow: a.refLow ?? '',
        refHigh: a.refHigh ?? '',
        criticalLow: a.criticalLow ?? '',
        criticalHigh: a.criticalHigh ?? '',
        normalValue: a.normalValue ?? '',
      })),
    });
    setFieldErrors({});
    setModalError(null);
    setEditing(test);
  };

  const setField = (name) => (event) => {
    setForm((prev) => ({ ...prev, [name]: event.target.value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const setAnalyte = (index, key, value) => {
    setForm((prev) => {
      const analytes = [...prev.analytes];
      analytes[index] = { ...analytes[index], [key]: value };
      return { ...prev, analytes };
    });
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setModalError(null);
    setFieldErrors({});

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      departmentId: form.departmentId,
      specimen: form.specimen,
      price: Number(form.price),
      turnaroundHours: Number(form.turnaroundHours || 24),
      analytes: form.analytes.map((a, index) => ({
        code: a.code.trim(),
        name: a.name.trim(),
        valueType: a.valueType,
        unit: a.unit.trim(),
        refLow: numOrNull(a.refLow),
        refHigh: numOrNull(a.refHigh),
        criticalLow: numOrNull(a.criticalLow),
        criticalHigh: numOrNull(a.criticalHigh),
        normalValue: a.normalValue.trim(),
        displayOrder: index + 1,
      })),
    };
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.category.trim()) payload.category = form.category.trim();
    if (form.preparationNotes.trim()) payload.preparationNotes = form.preparationNotes.trim();

    try {
      if (editing?._id) await labApi.updateTest(editing._id, payload);
      else await labApi.createTest(payload);
      setEditing(null);
      await load();
    } catch (err) {
      const errors = err.fieldErrors ?? {};
      setFieldErrors(errors);
      setModalError(
        Object.keys(errors).length
          ? `Please correct: ${Object.values(errors).join('; ')}`
          : err.message,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Lab test catalogue"
        description="Priced tests with their analytes and reference ranges."
        breadcrumb={<a href="/lab" className="hover:text-slate-700">← Laboratory</a>}
        action={canManage && <Button onClick={openCreate}>+ New test</Button>}
      />

      <div className="mb-4 max-w-sm">
        <input
          type="search"
          className="form-control"
          placeholder="Search tests…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search lab tests"
        />
      </div>

      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      <Table>
        <THead columns={COLUMNS} />
        <TBody>
          {loading && <TRMessage colSpan={COLUMNS.length}>Loading catalogue…</TRMessage>}
          {!loading && tests.length === 0 && (
            <TRMessage colSpan={COLUMNS.length}>No tests found.</TRMessage>
          )}
          {!loading && tests.map((test) => (
            <TR key={test._id}>
              <TD><Badge tone="info">{test.code}</Badge></TD>
              <TD>
                <div className="font-medium text-slate-900">{test.name}</div>
                {test.category && <div className="text-xs text-slate-400">{test.category}</div>}
              </TD>
              <TD>{test.departmentId?.name ?? '—'}</TD>
              <TD className="text-slate-500">{test.specimen}</TD>
              <TD>{test.analytes?.length ?? 0}</TD>
              <TD align="right" className="font-medium">{test.price}</TD>
              <TD align="right">
                {canManage && (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openEdit(test)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(test)}>Retire</Button>
                  </div>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Pagination meta={meta} onPageChange={setPage} />

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?._id ? 'Edit lab test' : 'New lab test'}
        description="Reference ranges here are snapshotted onto each result at entry time."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button form="lab-test-form" type="submit" loading={saving}>
              {editing?._id ? 'Save changes' : 'Create test'}
            </Button>
          </>
        }
      >
        <form id="lab-test-form" onSubmit={handleSave} noValidate className="space-y-4">
          {modalError && <Alert tone="error">{modalError}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Code" value={form.code} onChange={setField('code')} error={fieldErrors.code} placeholder="FBC" required />
            <Input label="Name" value={form.name} onChange={setField('name')} error={fieldErrors.name} placeholder="Full Blood Count" required />
            <Select label="Department" options={departmentOptions} placeholder="Select department" value={form.departmentId} onChange={setField('departmentId')} error={fieldErrors.departmentId} required />
            <Select label="Specimen" options={SPECIMEN_OPTIONS} value={form.specimen} onChange={setField('specimen')} error={fieldErrors.specimen} />
            <Input label="Category" value={form.category} onChange={setField('category')} placeholder="Haematology" />
            <Input label="Price" type="number" min="0" step="0.01" value={form.price} onChange={setField('price')} error={fieldErrors.price} required />
            <Input label="Turnaround (hours)" type="number" min="0" value={form.turnaroundHours} onChange={setField('turnaroundHours')} error={fieldErrors.turnaroundHours} />
          </div>

          <Textarea label="Preparation notes" rows={2} value={form.preparationNotes} onChange={setField('preparationNotes')} placeholder="e.g. Fasting required for 8 hours" />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Analytes</h3>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setForm((p) => ({ ...p, analytes: [...p.analytes, { ...BLANK_ANALYTE }] }))}
              >
                + Add analyte
              </Button>
            </div>

            {fieldErrors.analytes && (
              <p className="mb-2 text-xs text-red-600">{fieldErrors.analytes}</p>
            )}

            <div className="space-y-3">
              {form.analytes.map((analyte, index) => (
                <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-500">Analyte {index + 1}</span>
                    {form.analytes.length > 1 && (
                      <button
                        type="button"
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                        onClick={() => setForm((p) => ({
                          ...p, analytes: p.analytes.filter((_, i) => i !== index),
                        }))}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    <Input label="Code" value={analyte.code} onChange={(e) => setAnalyte(index, 'code', e.target.value)} placeholder="HGB" required />
                    <Input label="Name" className="sm:col-span-2" value={analyte.name} onChange={(e) => setAnalyte(index, 'name', e.target.value)} placeholder="Haemoglobin" required />
                    <Select
                      label="Type"
                      options={[{ value: 'numeric', label: 'Numeric' }, { value: 'text', label: 'Qualitative' }]}
                      value={analyte.valueType}
                      onChange={(e) => setAnalyte(index, 'valueType', e.target.value)}
                    />
                  </div>

                  {analyte.valueType === 'numeric' ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-5">
                      <Input label="Unit" value={analyte.unit} onChange={(e) => setAnalyte(index, 'unit', e.target.value)} placeholder="g/dL" />
                      <Input label="Ref low" type="number" step="any" value={analyte.refLow} onChange={(e) => setAnalyte(index, 'refLow', e.target.value)} />
                      <Input label="Ref high" type="number" step="any" value={analyte.refHigh} onChange={(e) => setAnalyte(index, 'refHigh', e.target.value)} />
                      <Input label="Critical low" type="number" step="any" value={analyte.criticalLow} onChange={(e) => setAnalyte(index, 'criticalLow', e.target.value)} />
                      <Input label="Critical high" type="number" step="any" value={analyte.criticalHigh} onChange={(e) => setAnalyte(index, 'criticalHigh', e.target.value)} />
                    </div>
                  ) : (
                    <div className="mt-3">
                      <Input
                        label="Normal value"
                        value={analyte.normalValue}
                        onChange={(e) => setAnalyte(index, 'normalValue', e.target.value)}
                        placeholder="negative"
                        hint="Anything else is flagged abnormal."
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Retire this test?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await labApi.retireTest(confirm._id);
                  setConfirm(null);
                  await load();
                } catch (err) {
                  setError(err.message);
                  setConfirm(null);
                }
              }}
            >
              Retire
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          <strong>{confirm?.name}</strong> will be hidden from new orders. Existing orders and
          results keep their snapshotted copy. Tests with orders in progress cannot be retired.
        </p>
      </Modal>
    </div>
  );
}

export default LabCatalogPage;
