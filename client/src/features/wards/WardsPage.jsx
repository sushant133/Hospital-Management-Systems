import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { wardsApi, WARD_TYPE_OPTIONS, WARD_GENDER_OPTIONS } from './wardsApi.js';
import { departmentsApi } from '../departments/departmentsApi.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { MODULES } from '../../app/permissions.js';
import { titleCase } from '../../lib/format.js';
import {
  Alert, Badge, Button, Input, Modal, PageHeader, Pagination, Select,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../components/ui/index.js';

const COLUMNS = [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Ward' },
  { key: 'dept', label: 'Department' },
  { key: 'type', label: 'Type' },
  { key: 'occupancy', label: 'Occupancy' },
  { key: 'actions', label: '', align: 'right' },
];

const BLANK = { code: '', name: '', departmentId: '', type: 'general', gender: 'mixed', floor: '' };

/** Small horizontal bar showing occupied vs available. */
function OccupancyBar({ occupancy }) {
  const total = occupancy?.total ?? 0;
  if (total === 0) return <span className="text-xs text-slate-400">No beds</span>;

  const occupied = occupancy.occupied ?? 0;
  const percent = Math.round((occupied / total) * 100);
  const tone = percent >= 90 ? 'bg-red-500' : percent >= 70 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="min-w-[9rem]">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-600">
          {occupancy.available ?? 0} free of {total}
        </span>
        <span className="font-medium text-slate-700">{percent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function WardsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can(MODULES.WARDS, 'edit');

  const [wards, setWards] = useState([]);
  const [meta, setMeta] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [departmentFilter, setDepartmentFilter] = useState('');

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [fieldErrors, setFieldErrors] = useState({});
  const [modalError, setModalError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    departmentsApi
      .list({ limit: 100, sort: 'name' })
      .then((response) => setDepartments(response.data))
      .catch(() => setDepartments([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await wardsApi.list({
        page,
        limit: 20,
        departmentId: departmentFilter || undefined,
      });
      setWards(response.data);
      setMeta(response.meta);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, departmentFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const departmentOptions = departments.map((d) => ({ value: d._id, label: `${d.code} — ${d.name}` }));

  const openCreate = () => {
    setForm(BLANK);
    setFieldErrors({});
    setModalError(null);
    setEditing({});
  };

  const openEdit = (ward) => {
    setForm({
      code: ward.code ?? '',
      name: ward.name ?? '',
      departmentId: ward.departmentId?._id ?? ward.departmentId ?? '',
      type: ward.type ?? 'general',
      gender: ward.gender ?? 'mixed',
      floor: ward.floor ?? '',
    });
    setFieldErrors({});
    setModalError(null);
    setEditing(ward);
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

    const payload = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== ''));

    try {
      if (editing?._id) await wardsApi.update(editing._id, payload);
      else await wardsApi.create(payload);
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
      await wardsApi.deactivate(confirm._id);
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
        title="Wards & Beds"
        description="Inpatient wards grouped by department, with live bed occupancy."
        action={canManage && <Button onClick={openCreate}>+ New ward</Button>}
      />

      <div className="mb-4 max-w-sm">
        <Select
          options={departmentOptions}
          placeholder="All departments"
          value={departmentFilter}
          onChange={(event) => {
            setDepartmentFilter(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by department"
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
          {loading && <TRMessage colSpan={COLUMNS.length}>Loading wards…</TRMessage>}
          {!loading && wards.length === 0 && (
            <TRMessage colSpan={COLUMNS.length}>No wards found.</TRMessage>
          )}
          {!loading &&
            wards.map((ward) => (
              <TR key={ward._id}>
                <TD>
                  <Badge tone="info">{ward.code}</Badge>
                </TD>
                <TD>
                  <Link
                    to={`/wards/${ward._id}`}
                    className="font-medium text-slate-900 hover:text-brand-600"
                  >
                    {ward.name}
                  </Link>
                  <div className="text-xs text-slate-400">
                    {titleCase(ward.gender)}
                    {ward.floor ? ` · Floor ${ward.floor}` : ''}
                  </div>
                </TD>
                <TD>{ward.departmentId?.name ?? '—'}</TD>
                <TD>
                  <Badge tone={ward.type === 'icu' || ward.type === 'nicu' ? 'danger' : 'neutral'}>
                    {titleCase(ward.type)}
                  </Badge>
                </TD>
                <TD>
                  <OccupancyBar occupancy={ward.occupancy} />
                </TD>
                <TD align="right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => navigate(`/wards/${ward._id}`)}>
                      Beds
                    </Button>
                    {canManage && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => openEdit(ward)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirm(ward)}>
                          Deactivate
                        </Button>
                      </>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
        </TBody>
      </Table>

      <Pagination meta={meta} onPageChange={setPage} />

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?._id ? 'Edit ward' : 'New ward'}
        description="Beds are added from the ward's bed roster after it is created."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button form="ward-form" type="submit" loading={saving}>
              {editing?._id ? 'Save changes' : 'Create ward'}
            </Button>
          </>
        }
      >
        <form id="ward-form" onSubmit={handleSave} noValidate className="space-y-4">
          {modalError && <Alert tone="error">{modalError}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Code" value={form.code} onChange={setField('code')} error={fieldErrors.code} placeholder="ICU-2" required />
            <Input label="Name" value={form.name} onChange={setField('name')} error={fieldErrors.name} placeholder="Intensive Care Unit 2" required />
            <Select
              label="Department"
              className="sm:col-span-2"
              options={departmentOptions}
              placeholder="Select a department"
              value={form.departmentId}
              onChange={setField('departmentId')}
              error={fieldErrors.departmentId}
              required
            />
            <Select label="Type" options={WARD_TYPE_OPTIONS} value={form.type} onChange={setField('type')} error={fieldErrors.type} />
            <Select label="Gender" options={WARD_GENDER_OPTIONS} value={form.gender} onChange={setField('gender')} error={fieldErrors.gender} />
            <Input label="Floor" value={form.floor} onChange={setField('floor')} error={fieldErrors.floor} />
          </div>
        </form>
      </Modal>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Deactivate ward?"
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
          <strong>{confirm?.name}</strong> and its beds will be soft-deleted. Wards with occupied or
          reserved beds cannot be deactivated.
        </p>
      </Modal>
    </div>
  );
}

export default WardsPage;
