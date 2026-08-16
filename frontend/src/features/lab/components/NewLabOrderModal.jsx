import { useEffect, useMemo, useState } from 'react';
import { labApi, LAB_PRIORITY_OPTIONS } from '../../../api/labApi.js';
import { api } from '../../../api/client.js';
import { staffApi } from '../../../api/staffApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { ROLES } from '../../../utils/roles.js';
import { fullName, formatDate } from '../../../utils/format.js';
import { Alert, Badge, Button, Modal, Select, Spinner, Textarea } from '../../../components/ui/index.js';

/**
 * Order tests for a patient.
 *
 * A lab order must hang off an open encounter, so the
 * modal resolves the patient's open visits first and blocks if there are none.
 */
export function NewLabOrderModal({ open, onClose, patient, onCreated }) {
  const { user, role } = useAuth();

  const [encounters, setEncounters] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);

  const [encounterId, setEncounterId] = useState('');
  const [orderedBy, setOrderedBy] = useState('');
  const [priority, setPriority] = useState('routine');
  const [selected, setSelected] = useState(new Set());
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');

  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const isDoctor = role === ROLES.DOCTOR;

  useEffect(() => {
    if (!open || !patient?._id) return undefined;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const requests = [
          api.get(`/patients/${patient._id}/encounters`, { params: { limit: 20 } }),
          labApi.listTests({ limit: 100, sort: 'name' }),
        ];
        // Non-doctors must name the ordering clinician explicitly.
        // The directory, not /users: a nurse placing an order holds
        // `staff.viewDirectory` but not the admin-only `staff.view`.
        if (!isDoctor) requests.push(staffApi.doctors());

        const [encounterRes, testRes, doctorRes] = await Promise.all(requests);
        if (cancelled) return;

        const open = encounterRes.data.filter((e) => ['open', 'admitted'].includes(e.status));
        setEncounters(open);
        setEncounterId(open[0]?._id ?? '');
        setTests(testRes.data);
        setDoctors(doctorRes?.data ?? []);
        if (isDoctor) setOrderedBy(user?.id ?? '');
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, patient?._id, isDoctor, user?.id]);

  // Reset selections each time the modal is opened.
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setNotes('');
      setSearch('');
      setPriority('routine');
    }
  }, [open]);

  const filteredTests = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tests;
    return tests.filter(
      (t) =>
        t.name.toLowerCase().includes(term) ||
        t.code.toLowerCase().includes(term) ||
        (t.category ?? '').toLowerCase().includes(term),
    );
  }, [tests, search]);

  const total = useMemo(
    () => tests.filter((t) => selected.has(t._id)).reduce((sum, t) => sum + (t.price ?? 0), 0),
    [tests, selected],
  );

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setError(null);

    if (!encounterId) return setError('Select the visit this order belongs to.');
    if (selected.size === 0) return setError('Select at least one test.');
    if (!isDoctor && !orderedBy) return setError('Select the ordering doctor.');

    setSaving(true);
    try {
      const payload = {
        patientId: patient._id,
        encounterId,
        labTestIds: [...selected],
        priority,
      };
      if (notes.trim()) payload.clinicalNotes = notes.trim();
      if (!isDoctor) payload.orderedBy = orderedBy;

      const response = await labApi.createOrder(payload);
      onCreated?.(response.data);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New lab order"
      description={patient ? `${fullName(patient)} · ${patient.mrn}` : ''}
      size="lg"
      footer={
        <>
          <div className="mr-auto text-sm text-slate-600">
            {selected.size} test{selected.size === 1 ? '' : 's'} ·{' '}
            <span className="font-semibold text-slate-900">{total.toFixed(2)}</span>
          </div>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={submit} disabled={loading}>
            Place order
          </Button>
        </>
      }
    >
      {loading ? (
        <Spinner label="Loading…" className="py-10" />
      ) : (
        <div className="space-y-4">
          {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

          {encounters.length === 0 ? (
            <Alert tone="warning" title="No open visit">
              Lab orders attach to a visit. Open an encounter for this patient first, then place the
              order.
            </Alert>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label="Visit"
                value={encounterId}
                onChange={(e) => setEncounterId(e.target.value)}
                options={encounters.map((e) => ({
                  value: e._id,
                  label: `${e.encounterNumber} · ${e.type.toUpperCase()} · ${formatDate(e.startedAt)}`,
                }))}
                required
              />
              {isDoctor ? (
                <Select
                  label="Ordering doctor"
                  value="self"
                  disabled
                  options={[{ value: 'self', label: `${fullName(user)} (you)` }]}
                />
              ) : (
                <Select
                  label="Ordering doctor"
                  placeholder="Select doctor"
                  value={orderedBy}
                  onChange={(e) => setOrderedBy(e.target.value)}
                  options={doctors.map((d) => ({ value: d._id, label: fullName(d) }))}
                  required
                />
              )}
              <Select
                label="Priority"
                options={LAB_PRIORITY_OPTIONS}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="form-label" htmlFor="lab-test-search">Tests</label>
            <input
              id="lab-test-search"
              type="search"
              className="form-control mb-2"
              placeholder="Search the catalogue…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {filteredTests.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-500">No tests match.</p>
              )}
              {filteredTests.map((test) => (
                <label
                  key={test._id}
                  className={[
                    'flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition-colors',
                    selected.has(test._id)
                      ? 'border-brand-300 bg-brand-50'
                      : 'border-transparent hover:bg-slate-50',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(test._id)}
                    onChange={() => toggle(test._id)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{test.name}</span>
                      <Badge tone="info">{test.code}</Badge>
                    </div>
                    <div className="text-xs text-slate-500">
                      {test.specimen} · {test.analytes?.length ?? 0} analyte(s)
                      {test.turnaroundHours ? ` · ~${test.turnaroundHours}h` : ''}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-slate-700">{test.price}</span>
                </label>
              ))}
            </div>
          </div>

          <Textarea
            label="Clinical notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reason for the request, relevant history…"
          />
        </div>
      )}
    </Modal>
  );
}

export default NewLabOrderModal;
