import { useEffect, useMemo, useState } from 'react';
import { radiologyApi, RAD_PRIORITY_OPTIONS, MODALITY_LABELS } from '../../../api/radiologyApi.js';
import { api } from '../../../api/client.js';
import { staffApi } from '../../../api/staffApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { ROLES } from '../../../utils/roles.js';
import { fullName, formatDate } from '../../../utils/format.js';
import { Alert, Badge, Button, Modal, Select, Spinner, Textarea } from '../../../components/ui/index.js';

/**
 * Order one imaging exam for a patient. Must hang off an open encounter.
 */
export function NewRadiologyOrderModal({ open, onClose, patient, onCreated }) {
  const { user, role } = useAuth();

  const [encounters, setEncounters] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);

  const [encounterId, setEncounterId] = useState('');
  const [orderedBy, setOrderedBy] = useState('');
  const [priority, setPriority] = useState('routine');
  const [examId, setExamId] = useState('');
  const [indication, setIndication] = useState('');
  const [search, setSearch] = useState('');

  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const isDoctor = role === ROLES.DOCTOR || role === ROLES.ADMIN;

  useEffect(() => {
    if (!open || !patient?._id) return undefined;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const requests = [
          api.get(`/patients/${patient._id}/encounters`, { params: { limit: 20 } }),
          radiologyApi.listExams({ limit: 100, sort: 'name' }),
        ];
        if (!isDoctor) requests.push(staffApi.doctors());

        const [encounterRes, examRes, doctorRes] = await Promise.all(requests);
        if (cancelled) return;

        const openVisits = encounterRes.data.filter((e) => ['open', 'admitted'].includes(e.status));
        setEncounters(openVisits);
        setEncounterId(openVisits[0]?._id ?? '');
        setExams(examRes.data);
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

  useEffect(() => {
    if (open) {
      setExamId('');
      setIndication('');
      setSearch('');
      setPriority('routine');
    }
  }, [open]);

  const filteredExams = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return exams;
    return exams.filter(
      (exam) =>
        exam.name.toLowerCase().includes(term) ||
        exam.code.toLowerCase().includes(term) ||
        exam.bodyPart.toLowerCase().includes(term) ||
        exam.modality.toLowerCase().includes(term),
    );
  }, [exams, search]);

  const selected = exams.find((exam) => exam._id === examId);

  const submit = async () => {
    setError(null);

    if (!encounterId) return setError('Select the visit this order belongs to.');
    if (!examId) return setError('Select one examination.');
    if (indication.trim().length < 8) return setError('Give a clinical indication (at least 8 characters).');
    if (!isDoctor && !orderedBy) return setError('Select the ordering doctor.');

    setSaving(true);
    try {
      const payload = {
        patientId: patient._id,
        encounterId,
        examId,
        priority,
        clinicalIndication: indication.trim(),
      };
      if (!isDoctor) payload.orderedBy = orderedBy;

      const response = await radiologyApi.createOrder(payload);
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
      title="New imaging order"
      description={patient ? `${fullName(patient)} · ${patient.mrn}` : ''}
      size="lg"
      footer={
        <>
          <div className="mr-auto text-sm text-slate-600">
            {selected ? (
              <>
                {selected.name} · <span className="font-semibold text-slate-900">{selected.price}</span>
              </>
            ) : (
              'Select one exam'
            )}
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
              Imaging orders attach to a visit. Open an encounter for this patient first, then place
              the order.
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
                options={RAD_PRIORITY_OPTIONS}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="form-label" htmlFor="rad-exam-search">Examination</label>
            <input
              id="rad-exam-search"
              type="search"
              className="form-control mb-2"
              placeholder="Search the catalogue…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {filteredExams.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-500">No exams match.</p>
              )}
              {filteredExams.map((exam) => (
                <label
                  key={exam._id}
                  className={[
                    'flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition-colors',
                    examId === exam._id
                      ? 'border-brand-300 bg-brand-50'
                      : 'border-transparent hover:bg-slate-50',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="exam"
                    checked={examId === exam._id}
                    onChange={() => setExamId(exam._id)}
                    className="h-4 w-4 border-slate-300"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{exam.name}</span>
                      <Badge tone="info">{exam.code}</Badge>
                    </div>
                    <div className="text-xs text-slate-500">
                      {MODALITY_LABELS[exam.modality] ?? exam.modality} · {exam.bodyPart}
                      {exam.contrastRequired ? ' · contrast' : ''}
                      {exam.durationMinutes ? ` · ${exam.durationMinutes} min` : ''}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-slate-700">{exam.price}</span>
                </label>
              ))}
            </div>
          </div>

          <Textarea
            label="Clinical indication"
            rows={3}
            value={indication}
            onChange={(e) => setIndication(e.target.value)}
            placeholder="Why is this study being requested?"
            required
          />
        </div>
      )}
    </Modal>
  );
}

export default NewRadiologyOrderModal;
