import { useCallback, useEffect, useState } from 'react';
import { radiologyApi, MODALITY_OPTIONS, MODALITY_LABELS } from '../../../api/radiologyApi.js';
import { departmentsApi } from '../../../api/departmentApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import {
  Alert, Badge, Button, Input, Modal, PageHeader, Pagination, Select,
  Table, TBody, TD, THead, TR, TRMessage, Textarea,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Exam' },
  { key: 'modality', label: 'Modality' },
  { key: 'body', label: 'Body part' },
  { key: 'mins', label: 'Mins' },
  { key: 'price', label: 'Price', align: 'right' },
  { key: 'actions', label: '', align: 'right' },
];

const BLANK = {
  code: '',
  name: '',
  description: '',
  modality: 'xray',
  bodyPart: '',
  departmentId: '',
  price: '',
  durationMinutes: '15',
  contrastRequired: false,
  typicalDoseMsv: '0',
  preparationNotes: '',
};

export function RadiologyCatalogPage() {
  const { can } = useAuth();
  const canManage = can(MODULES.RADIOLOGY_EXAMS, 'edit');

  const [exams, setExams] = useState([]);
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
      const response = await radiologyApi.listExams({
        page,
        limit: 20,
        search: debounced || undefined,
      });
      setExams(response.data);
      setMeta(response.meta);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, debounced]);

  useEffect(() => { load(); }, [load]);

  const departmentOptions = departments.map((d) => ({
    value: d._id,
    label: `${d.code} — ${d.name}`,
  }));

  const setField = (name) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const openCreate = () => {
    const rad = departments.find((d) => d.code === 'RAD');
    setForm({ ...BLANK, departmentId: rad?._id ?? '' });
    setFieldErrors({});
    setModalError(null);
    setEditing({});
  };

  const openEdit = (exam) => {
    setForm({
      code: exam.code ?? '',
      name: exam.name ?? '',
      description: exam.description ?? '',
      modality: exam.modality ?? 'xray',
      bodyPart: exam.bodyPart ?? '',
      departmentId: exam.departmentId?._id ?? exam.departmentId ?? '',
      price: String(exam.price ?? ''),
      durationMinutes: String(exam.durationMinutes ?? '15'),
      contrastRequired: Boolean(exam.contrastRequired),
      typicalDoseMsv: String(exam.typicalDoseMsv ?? '0'),
      preparationNotes: exam.preparationNotes ?? '',
    });
    setFieldErrors({});
    setModalError(null);
    setEditing(exam);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setModalError(null);
    setFieldErrors({});

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      modality: form.modality,
      bodyPart: form.bodyPart.trim(),
      departmentId: form.departmentId,
      price: Number(form.price),
      durationMinutes: Number(form.durationMinutes || 15),
      contrastRequired: Boolean(form.contrastRequired),
      typicalDoseMsv: Number(form.typicalDoseMsv || 0),
    };
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.preparationNotes.trim()) payload.preparationNotes = form.preparationNotes.trim();

    try {
      if (editing?._id) await radiologyApi.updateExam(editing._id, payload);
      else await radiologyApi.createExam(payload);
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

  const handleRetire = async () => {
    if (!confirm) return;
    try {
      await radiologyApi.retireExam(confirm._id);
      setConfirm(null);
      await load();
    } catch (err) {
      setError(err.message);
      setConfirm(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Imaging catalogue"
        description="Priced examinations. Orders snapshot name, modality and price."
        breadcrumb={<a href="/radiology" className="hover:text-slate-700">← Radiology</a>}
        action={canManage && <Button onClick={openCreate}>+ New exam</Button>}
      />

      <div className="mb-4 max-w-sm">
        <input
          type="search"
          className="form-control"
          placeholder="Search exams…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search imaging exams"
        />
      </div>

      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      <Table>
        <THead columns={COLUMNS} />
        <TBody>
          {loading && <TRMessage colSpan={COLUMNS.length}>Loading catalogue…</TRMessage>}
          {!loading && exams.length === 0 && (
            <TRMessage colSpan={COLUMNS.length}>No exams found.</TRMessage>
          )}
          {!loading &&
            exams.map((exam) => (
              <TR key={exam._id}>
                <TD><Badge tone="info">{exam.code}</Badge></TD>
                <TD>
                  <div className="font-medium text-slate-900">{exam.name}</div>
                  {exam.contrastRequired && (
                    <div className="text-xs text-amber-700">Contrast required</div>
                  )}
                </TD>
                <TD>{MODALITY_LABELS[exam.modality] ?? exam.modality}</TD>
                <TD className="text-slate-500">{exam.bodyPart}</TD>
                <TD className="text-slate-500">{exam.durationMinutes}</TD>
                <TD align="right" className="font-medium">{exam.price}</TD>
                <TD align="right">
                  {canManage && (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => openEdit(exam)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(exam)}>
                        Retire
                      </Button>
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
        title={editing?._id ? 'Edit exam' : 'New exam'}
        description="Price and duration changes apply to new orders only."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button form="rad-exam-form" type="submit" loading={saving}>
              {editing?._id ? 'Save changes' : 'Create exam'}
            </Button>
          </>
        }
      >
        <form id="rad-exam-form" onSubmit={handleSave} noValidate className="space-y-4">
          {modalError && <Alert tone="error">{modalError}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Code" value={form.code} onChange={setField('code')} error={fieldErrors.code} placeholder="CXR" required />
            <Input label="Name" value={form.name} onChange={setField('name')} error={fieldErrors.name} placeholder="Chest X-ray PA" required />
            <Select label="Department" options={departmentOptions} placeholder="Select department" value={form.departmentId} onChange={setField('departmentId')} error={fieldErrors.departmentId} required />
            <Select label="Modality" options={MODALITY_OPTIONS} value={form.modality} onChange={setField('modality')} error={fieldErrors.modality} />
            <Input label="Body part" value={form.bodyPart} onChange={setField('bodyPart')} error={fieldErrors.bodyPart} placeholder="Chest" required />
            <Input label="Price" type="number" min="0" step="0.01" value={form.price} onChange={setField('price')} error={fieldErrors.price} required />
            <Input label="Duration (minutes)" type="number" min="5" value={form.durationMinutes} onChange={setField('durationMinutes')} error={fieldErrors.durationMinutes} />
            <Input label="Typical dose (mSv)" type="number" min="0" step="0.01" value={form.typicalDoseMsv} onChange={setField('typicalDoseMsv')} error={fieldErrors.typicalDoseMsv} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.contrastRequired} onChange={setField('contrastRequired')} />
            Contrast required
          </label>
          <Textarea label="Preparation notes" rows={2} value={form.preparationNotes} onChange={setField('preparationNotes')} />
        </form>
      </Modal>

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title="Retire this exam?"
        description={confirm ? `${confirm.code} — ${confirm.name}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Keep</Button>
            <Button variant="danger" onClick={handleRetire}>Retire</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Existing orders keep their snapshot. New orders will not be able to select this exam.
        </p>
      </Modal>
    </div>
  );
}

export default RadiologyCatalogPage;
