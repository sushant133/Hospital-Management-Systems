import { useCallback, useEffect, useState } from 'react';
import { staffApi } from '../../../api/staffApi.js';
import { departmentsApi } from '../../../api/departmentApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { ROLE_LABELS, ROLE_VALUES } from '../../../utils/roles.js';
import { fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Input, Modal, PageHeader, Pagination, Select,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'emp', label: 'Employee' },
  { key: 'name', label: 'Name' },
  { key: 'role', label: 'Role' },
  { key: 'dept', label: 'Department' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];

const BLANK = {
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  phone: '',
  role: 'staff',
  departmentId: '',
  specialization: '',
  licenseNumber: '',
};

const ROLE_OPTIONS = ROLE_VALUES.map((value) => ({ value, label: ROLE_LABELS[value] }));

export function StaffPage() {
  const { user, can } = useAuth();
  const canCreate = can(MODULES.STAFF, 'create');
  const canEdit = can(MODULES.STAFF, 'edit');
  const canDelete = can(MODULES.STAFF, 'delete');
  const canRestore = can(MODULES.STAFF, 'restore');
  const canReset = can(MODULES.STAFF, 'resetPassword');

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [role, setRole] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [fieldErrors, setFieldErrors] = useState({});
  const [modalError, setModalError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(search); setPage(1); }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    departmentsApi.list({ limit: 100, sort: 'name' })
      .then((r) => setDepartments(r.data))
      .catch(() => setDepartments([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await staffApi.list({
        page,
        limit: 20,
        search: debounced || undefined,
        role: role || undefined,
        includeInactive: includeInactive ? 'true' : undefined,
        sort: 'lastName,firstName',
      });
      setRows(response.data);
      setMeta(response.meta);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, debounced, role, includeInactive]);

  useEffect(() => { load(); }, [load]);

  const departmentOptions = [
    { value: '', label: 'No department' },
    ...departments.map((d) => ({ value: d._id, label: `${d.code} — ${d.name}` })),
  ];

  const setField = (name) => (event) => {
    setForm((prev) => ({ ...prev, [name]: event.target.value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const openCreate = () => {
    setForm(BLANK);
    setFieldErrors({});
    setModalError(null);
    setEditing({});
  };

  const openEdit = (member) => {
    setForm({
      email: member.email ?? '',
      password: '',
      firstName: member.firstName ?? '',
      lastName: member.lastName ?? '',
      phone: member.phone ?? '',
      role: member.role ?? 'staff',
      departmentId: member.departmentId?._id ?? member.departmentId ?? '',
      specialization: member.specialization ?? '',
      licenseNumber: member.licenseNumber ?? '',
    });
    setFieldErrors({});
    setModalError(null);
    setEditing(member);
  };

  const isSelf = editing?._id && user && String(editing._id) === String(user.id ?? user._id);

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setModalError(null);
    setFieldErrors({});

    try {
      if (editing?._id) {
        const payload = {
          email: form.email.trim(),
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          departmentId: form.departmentId || null,
        };
        if (form.phone.trim()) payload.phone = form.phone.trim();
        if (form.specialization.trim()) payload.specialization = form.specialization.trim();
        if (form.licenseNumber.trim()) payload.licenseNumber = form.licenseNumber.trim();
        if (!isSelf) payload.role = form.role;
        await staffApi.update(editing._id, payload);
      } else {
        const payload = {
          email: form.email.trim(),
          password: form.password,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          role: form.role,
          mustChangePassword: true,
        };
        if (form.phone.trim()) payload.phone = form.phone.trim();
        if (form.departmentId) payload.departmentId = form.departmentId;
        if (form.specialization.trim()) payload.specialization = form.specialization.trim();
        if (form.licenseNumber.trim()) payload.licenseNumber = form.licenseNumber.trim();
        await staffApi.create(payload);
      }
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

  const handleDeactivate = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await staffApi.deactivate(confirm._id);
      setConfirm(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (member) => {
    setBusy(true);
    try {
      await staffApi.restore(member._id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (event) => {
    event.preventDefault();
    if (!resetTarget) return;
    setBusy(true);
    setModalError(null);
    try {
      await staffApi.resetPassword(resetTarget._id, {
        newPassword,
        mustChangePassword: true,
      });
      setResetTarget(null);
      setNewPassword('');
    } catch (err) {
      setModalError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Staff accounts"
        description="Employment records — role, department and login. The directory used elsewhere never includes these."
        action={canCreate && <Button onClick={openCreate}>+ New account</Button>}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <input
            type="search"
            className="form-control"
            placeholder="Search name, email, employee id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search staff"
          />
        </div>
        <Select
          label="Role"
          value={role}
          onChange={(e) => { setRole(e.target.value); setPage(1); }}
          options={[{ value: '', label: 'Any role' }, ...ROLE_OPTIONS]}
          className="w-48"
        />
        <label className="mb-2 flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => { setIncludeInactive(e.target.checked); setPage(1); }}
          />
          Include inactive
        </label>
      </div>

      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      <Table>
        <THead columns={COLUMNS} />
        <TBody>
          {loading && <TRMessage colSpan={COLUMNS.length}>Loading staff…</TRMessage>}
          {!loading && rows.length === 0 && (
            <TRMessage colSpan={COLUMNS.length}>No staff accounts match.</TRMessage>
          )}
          {!loading &&
            rows.map((member) => {
              const self = user && String(member._id) === String(user.id ?? user._id);
              return (
                <TR key={member._id}>
                  <TD className="font-mono text-xs">{member.employeeId}</TD>
                  <TD>
                    <div className="font-medium text-slate-900">{fullName(member)}</div>
                    <div className="text-xs text-slate-400">{member.email}</div>
                  </TD>
                  <TD>{ROLE_LABELS[member.role] ?? member.role}</TD>
                  <TD className="text-slate-500">{member.departmentId?.name ?? '—'}</TD>
                  <TD>
                    <Badge tone={member.isActive ? 'success' : 'neutral'}>
                      {member.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    {member.mustChangePassword && member.isActive && (
                      <Badge tone="warning" className="ml-1">Must change password</Badge>
                    )}
                  </TD>
                  <TD align="right">
                    <div className="flex justify-end gap-2">
                      {canEdit && member.isActive && (
                        <Button size="sm" variant="secondary" onClick={() => openEdit(member)}>
                          Edit
                        </Button>
                      )}
                      {canReset && member.isActive && (
                        <Button size="sm" variant="ghost" onClick={() => { setNewPassword(''); setModalError(null); setResetTarget(member); }}>
                          Reset password
                        </Button>
                      )}
                      {canDelete && member.isActive && !self && (
                        <Button size="sm" variant="ghost" onClick={() => setConfirm(member)}>
                          Deactivate
                        </Button>
                      )}
                      {canRestore && !member.isActive && (
                        <Button size="sm" variant="secondary" loading={busy} onClick={() => handleRestore(member)}>
                          Restore
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })}
        </TBody>
      </Table>

      <Pagination meta={meta} onPageChange={setPage} />

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?._id ? 'Edit staff account' : 'New staff account'}
        description={editing?._id ? `${editing.employeeId ?? ''} · ${editing.email ?? ''}` : 'They will be asked to change the password on first sign-in.'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button form="staff-form" type="submit" loading={saving}>
              {editing?._id ? 'Save changes' : 'Create account'}
            </Button>
          </>
        }
      >
        <form id="staff-form" onSubmit={handleSave} noValidate className="space-y-4">
          {modalError && <Alert tone="error">{modalError}</Alert>}
          {isSelf && (
            <Alert tone="info">You cannot change your own role from here.</Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="First name" value={form.firstName} onChange={setField('firstName')} error={fieldErrors.firstName} required />
            <Input label="Last name" value={form.lastName} onChange={setField('lastName')} error={fieldErrors.lastName} required />
            <Input label="Email" type="email" value={form.email} onChange={setField('email')} error={fieldErrors.email} required />
            <Input label="Phone" value={form.phone} onChange={setField('phone')} error={fieldErrors.phone} />
            <Select
              label="Role"
              options={ROLE_OPTIONS}
              value={form.role}
              onChange={setField('role')}
              error={fieldErrors.role}
              disabled={Boolean(isSelf)}
              required
            />
            <Select
              label="Department"
              options={departmentOptions}
              value={form.departmentId}
              onChange={setField('departmentId')}
              error={fieldErrors.departmentId}
            />
            {!editing?._id && (
              <Input
                label="Temporary password"
                type="password"
                value={form.password}
                onChange={setField('password')}
                error={fieldErrors.password}
                hint="8+ characters, with upper, lower and a number"
                required
              />
            )}
            <Input label="Specialization" value={form.specialization} onChange={setField('specialization')} />
            <Input label="License number" value={form.licenseNumber} onChange={setField('licenseNumber')} />
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title="Deactivate this account?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Keep</Button>
            <Button variant="danger" loading={busy} onClick={handleDeactivate}>Deactivate</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          <strong>{confirm ? fullName(confirm) : ''}</strong> will be signed out of every session
          and hidden from assignment lists. The account can be restored later.
        </p>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        title="Reset password"
        description={resetTarget ? `${fullName(resetTarget)} · ${resetTarget.email}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button form="reset-form" type="submit" loading={busy}>Reset and sign them out</Button>
          </>
        }
      >
        <form id="reset-form" onSubmit={handleReset} className="space-y-3">
          {modalError && <Alert tone="error">{modalError}</Alert>}
          <Input
            label="New temporary password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            hint="They will be required to change it on next sign-in."
            required
          />
        </form>
      </Modal>
    </div>
  );
}

export default StaffPage;
