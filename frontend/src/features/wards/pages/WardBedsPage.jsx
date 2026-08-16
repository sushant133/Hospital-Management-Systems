import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { wardsApi, BED_STATUS_OPTIONS, BED_STATUS_TONES } from '../../../api/wardApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { fullName, titleCase } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, StatCard,
} from '../../../components/ui/index.js';

export function WardBedsPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const canManage = can(MODULES.BEDS, 'create');
  const canChangeStatus = can(MODULES.BEDS, 'changeStatus');

  const [ward, setWard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState('single');
  const [single, setSingle] = useState({ bedNumber: '', dailyRate: '' });
  const [range, setRange] = useState({ prefix: '', from: '1', to: '10', dailyRate: '' });
  const [addError, setAddError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const [statusBed, setStatusBed] = useState(null);
  const [newStatus, setNewStatus] = useState('available');
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await wardsApi.get(id);
      setWard(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async (event) => {
    event.preventDefault();
    setSaving(true);
    setAddError(null);
    setFieldErrors({});

    try {
      if (addMode === 'single') {
        const payload = { bedNumber: single.bedNumber.trim() };
        if (single.dailyRate !== '') payload.dailyRate = Number(single.dailyRate);
        await wardsApi.createBed(id, payload);
        setNotice(`Bed ${payload.bedNumber} added.`);
      } else {
        const payload = { from: Number(range.from), to: Number(range.to) };
        if (range.prefix.trim()) payload.prefix = range.prefix.trim();
        if (range.dailyRate !== '') payload.dailyRate = Number(range.dailyRate);
        const response = await wardsApi.createBedRange(id, payload);
        setNotice(response.message);
      }
      setAddOpen(false);
      setSingle({ bedNumber: '', dailyRate: '' });
      await load();
    } catch (err) {
      const errors = err.fieldErrors ?? {};
      setFieldErrors(errors);
      setAddError(Object.keys(errors).length ? 'Please correct the highlighted fields.' : err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async () => {
    setUpdating(true);
    try {
      await wardsApi.updateBed(id, statusBed._id, { status: newStatus });
      setStatusBed(null);
      setNotice(`Bed ${statusBed.bedNumber} set to ${newStatus}.`);
      await load();
    } catch (err) {
      setError(err.message);
      setStatusBed(null);
    } finally {
      setUpdating(false);
    }
  };

  const handleRemove = async (bed) => {
    try {
      await wardsApi.deleteBed(id, bed._id);
      setNotice(`Bed ${bed.bedNumber} removed.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <Spinner label="Loading ward…" className="py-20" />;

  if (error && !ward) {
    return (
      <div>
        <Alert tone="error" title="Could not load ward">
          {error}
        </Alert>
        <Link to="/wards" className="mt-4 inline-block text-sm text-brand-600 hover:text-brand-700">
          ← Back to wards
        </Link>
      </div>
    );
  }

  const occupancy = ward.occupancy ?? {};
  const beds = ward.beds ?? [];

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link to="/wards" className="hover:text-slate-700">
            ← Wards & Beds
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {ward.name}
            <Badge tone="info">{ward.code}</Badge>
          </span>
        }
        description={`${ward.departmentId?.name ?? 'Unassigned'} · ${titleCase(ward.type)} · ${titleCase(ward.gender)}${ward.floor ? ` · Floor ${ward.floor}` : ''}`}
        action={canManage && <Button onClick={() => { setAddOpen(true); setAddError(null); }}>+ Add beds</Button>}
      />

      {notice && (
        <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total beds" value={occupancy.total ?? 0} tone="slate" />
        <StatCard label="Available" value={occupancy.available ?? 0} tone="emerald" />
        <StatCard label="Occupied" value={occupancy.occupied ?? 0} tone="brand" />
        <StatCard
          label="Out of service"
          value={(occupancy.maintenance ?? 0) + (occupancy.cleaning ?? 0)}
          tone="amber"
          hint="Cleaning or maintenance"
        />
      </div>

      {beds.length === 0 ? (
        <EmptyState
          icon="🛏️"
          title="No beds in this ward"
          description="Add beds individually or create a numbered range."
          action={canManage && <Button onClick={() => setAddOpen(true)}>+ Add beds</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {beds.map((bed) => (
            <Card key={bed._id} className="flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-900">
                    {bed.bedNumber}
                  </span>
                  <Badge tone={BED_STATUS_TONES[bed.status] ?? 'neutral'}>{bed.status}</Badge>
                </div>
                {bed.currentPatientId ? (
                  <p className="mt-2 text-xs text-slate-600">
                    {fullName(bed.currentPatientId)}
                    <span className="block text-slate-400">{bed.currentPatientId.mrn}</span>
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">Unoccupied</p>
                )}
                {bed.dailyRate > 0 && (
                  <p className="mt-1 text-xs text-slate-500">Rate: {bed.dailyRate}/day</p>
                )}
              </div>

              {(canChangeStatus || canManage) && (
                <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                  {canChangeStatus && bed.status !== 'occupied' && (
                    <button
                      type="button"
                      onClick={() => {
                        setStatusBed(bed);
                        setNewStatus(bed.status === 'available' ? 'cleaning' : 'available');
                      }}
                      className="text-xs font-medium text-brand-600 hover:text-brand-700"
                    >
                      Change status
                    </button>
                  )}
                  {canManage && bed.status !== 'occupied' && (
                    <button
                      type="button"
                      onClick={() => handleRemove(bed)}
                      className="ml-auto text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add beds"
        description="Create one bed, or a numbered range in a single step."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button form="bed-form" type="submit" loading={saving}>
              Add
            </Button>
          </>
        }
      >
        <form id="bed-form" onSubmit={handleAdd} noValidate className="space-y-4">
          {addError && <Alert tone="error">{addError}</Alert>}

          <div className="flex gap-2">
            {['single', 'range'].map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAddMode(mode)}
                className={[
                  'rounded-lg border px-3 py-1.5 text-sm font-medium',
                  addMode === mode
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                ].join(' ')}
              >
                {mode === 'single' ? 'Single bed' : 'Numbered range'}
              </button>
            ))}
          </div>

          {addMode === 'single' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Bed number"
                value={single.bedNumber}
                onChange={(e) => setSingle({ ...single, bedNumber: e.target.value })}
                error={fieldErrors.bedNumber}
                placeholder="A-01"
                required
              />
              <Input
                label="Daily rate"
                type="number"
                min="0"
                value={single.dailyRate}
                onChange={(e) => setSingle({ ...single, dailyRate: e.target.value })}
                error={fieldErrors.dailyRate}
                placeholder="0"
              />
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Prefix"
                  value={range.prefix}
                  onChange={(e) => setRange({ ...range, prefix: e.target.value })}
                  error={fieldErrors.prefix}
                  placeholder="A-"
                  hint="Optional, e.g. 'A-' gives A-1, A-2…"
                />
                <Input
                  label="Daily rate"
                  type="number"
                  min="0"
                  value={range.dailyRate}
                  onChange={(e) => setRange({ ...range, dailyRate: e.target.value })}
                  error={fieldErrors.dailyRate}
                  placeholder="0"
                />
                <Input
                  label="From"
                  type="number"
                  min="1"
                  value={range.from}
                  onChange={(e) => setRange({ ...range, from: e.target.value })}
                  error={fieldErrors.from}
                  required
                />
                <Input
                  label="To"
                  type="number"
                  min="1"
                  value={range.to}
                  onChange={(e) => setRange({ ...range, to: e.target.value })}
                  error={fieldErrors.to}
                  required
                />
              </div>
              <p className="text-xs text-slate-500">
                Existing bed numbers are skipped. Maximum 200 beds per batch.
              </p>
            </>
          )}
        </form>
      </Modal>

      <Modal
        open={statusBed !== null}
        onClose={() => setStatusBed(null)}
        title={`Change status — bed ${statusBed?.bedNumber ?? ''}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setStatusBed(null)}>
              Cancel
            </Button>
            <Button loading={updating} onClick={handleStatusChange}>
              Update
            </Button>
          </>
        }
      >
        <Select
          label="New status"
          options={BED_STATUS_OPTIONS}
          value={newStatus}
          onChange={(event) => setNewStatus(event.target.value)}
          hint="Occupied is set by the admission workflow, not manually."
        />
      </Modal>
    </div>
  );
}

export default WardBedsPage;
