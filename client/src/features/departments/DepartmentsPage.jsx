import { useCallback, useEffect, useState } from 'react';
import { departmentsApi } from './departmentsApi.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { MODULES } from '../../app/permissions.js';
import { fullName } from '../../lib/format.js';
import {
  Alert, Badge, Button, Input, Modal, PageHeader, Pagination, Table, TBody, TD, THead, TR, TRMessage, Textarea,
} from '../../components/ui/index.js';

const COLUMNS = [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Department' },
  { key: 'head', label: 'Head' },
  { key: 'floor', label: 'Floor' },
  { key: 'wards', label: 'Wards / Beds' },
  { key: 'actions', label: '', align: 'right' },
];

const BLANK = { code: '', name: '', description: '', floor: '', phone: '', extension: '' };

export function DepartmentsPage() {
  const { can } = useAuth();
  const canManage = can(MODULES.DEPARTMENTS, 'edit');

  const [departments, setDepartments] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  const [editing, setEditing] = useState(null); // null = closed, {} = create, {…} = edit
  const [form, setForm] = useState(BLANK);
  const [fieldErrors, setFieldErrors] = useState({});
  const [modalError, setModalError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await departmentsApi.list({ page, limit: 20, search: debounced || undefined });
      setDepartments(response.data);
      setMeta(response.meta);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, debounced]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setForm(BLANK);
    setFieldErrors({});
    setModalError(null);
    setEditing({});
  };

  const openEdit = (department) => {
    setForm({
      code: department.code ?? '',
      name: department.name ?? '',
      description: department.description ?? '',
      floor: department.floor ?? '',
      phone: department.phone ?? '',
      extension: department.extension ?? '',
    });
    setFieldErrors({});
    setModalError(null);
    setEditing(department);
  };

  const setField = (name) => (event) => {
    setForm((prev) => ({ ...prev, [name]: event.target.value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setModalError(null);
    setFieldErrors({});

    // Drop empties so optional fields aren't sent as ''.
    const payload = Object.fromEntries(
      Object.entries(form).filter(([, value]) => value !== ''),
    );

    try {
      if (editing?._id) await departmentsApi.update(editing._id, payload);
      else await departmentsApi.create(payload);
      setEditing(null);
      await load();
    } catch (err) {
      const errors = err.fieldErrors ?? {};
      setFieldErrors(errors);
      setModalError(
        Object.keys(errors).length ? 'Please correct the highlighted fields.' : err.message,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await departmentsApi.deactivate(confirm._id);
      setConfirm(null);
      await load();
    } catch (err) {
      setError(err.message);
      setConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Departments"
        description="Clinical and operational departments across the hospital."
        action={canManage && <Button onClick={openCreate}>+ New department</Button>}
      />

      <div className="mb-4 max-w-sm">
        <input
          type="search"
          className="form-control"
          placeholder="Search departments…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search departments"
        />
      </div>

      {error && (
        <Alert tone="error" title="Something went wrong" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Table>
        <THead columns={COLUMNS} />
        <TBody>
          {loading && <TRMessage colSpan={COLUMNS.length}>Loading departments…</TRMessage>}
          {!loading && departments.length === 0 && (
            <TRMessage colSpan={COLUMNS.length}>No departments found.</TRMessage>
          )}
          {!loading &&
            departments.map((department) => (
              <TR key={department._id}>
                <TD>
                  <Badge tone="info">{department.code}</Badge>
                </TD>
                <TD>
                  <div className="font-medium text-slate-900">{department.name}</div>
                  {department.description && (
                    <div className="max-w-md truncate text-xs text-slate-500">
                      {department.description}
                    </div>
                  )}
                </TD>
                <TD>{department.headOfDepartmentId ? fullName(department.headOfDepartmentId) : '—'}</TD>
                <TD>{department.floor || '—'}</TD>
                <TD>
                  <span className="text-slate-900">{department.wardCount ?? 0}</span>
                  <span className="text-slate-400"> wards · </span>
                  <span className="text-slate-900">{department.bedCount ?? 0}</span>
                  <span className="text-slate-400"> beds</span>
                </TD>
                <TD align="right">
                  {canManage && (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => openEdit(department)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(department)}>
                        Deactivate
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
        title={editing?._id ? 'Edit department' : 'New department'}
        description="Departments group wards, staff and encounters."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button form="department-form" type="submit" loading={saving}>
              {editing?._id ? 'Save changes' : 'Create department'}
            </Button>
          </>
        }
      >
        <form id="department-form" onSubmit={handleSave} noValidate className="space-y-4">
          {modalError && <Alert tone="error">{modalError}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Code"
              value={form.code}
              onChange={setField('code')}
              error={fieldErrors.code}
              placeholder="CARD"
              hint="2–12 characters, letters/numbers/hyphens"
              required
            />
            <Input label="Name" value={form.name} onChange={setField('name')} error={fieldErrors.name} placeholder="Cardiology" required />
            <Input label="Floor" value={form.floor} onChange={setField('floor')} error={fieldErrors.floor} placeholder="3" />
            <Input label="Phone" value={form.phone} onChange={setField('phone')} error={fieldErrors.phone} />
            <Input label="Extension" value={form.extension} onChange={setField('extension')} error={fieldErrors.extension} />
          </div>

          <Textarea
            label="Description"
            value={form.description}
            onChange={setField('description')}
            error={fieldErrors.description}
            rows={3}
          />
        </form>
      </Modal>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Deactivate department?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>
              Deactivate
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          <strong>{confirm?.name}</strong> will be soft-deleted and hidden from selection lists.
          Departments with active wards or open visits cannot be deactivated.
        </p>
      </Modal>
    </div>
  );
}

export default DepartmentsPage;
