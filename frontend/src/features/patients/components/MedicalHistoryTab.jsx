import { useState } from 'react';
import { patientsApi, SEVERITY_OPTIONS, CONDITION_STATUS_OPTIONS } from '../../../api/patientApi.js';
import { formatDate, toDateInput, titleCase } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, Input, Select, Textarea,
} from '../../../components/ui/index.js';

/**
 * Each section is an editable array. The API replaces whole sections, so we
 * send only the section being saved — the rest is left untouched server-side.
 */
const SECTIONS = [
  {
    key: 'allergies',
    title: 'Allergies',
    icon: '⚠️',
    empty: 'No known allergies recorded.',
    blank: { substance: '', reaction: '', severity: 'moderate' },
    fields: [
      { name: 'substance', label: 'Substance', required: true },
      { name: 'reaction', label: 'Reaction' },
      { name: 'severity', label: 'Severity', type: 'select', options: SEVERITY_OPTIONS },
    ],
    render: (item) => (
      <>
        <span className="font-medium text-slate-900">{item.substance}</span>
        {item.reaction && <span className="text-slate-500"> — {item.reaction}</span>}
        <Badge
          tone={item.severity === 'severe' ? 'danger' : item.severity === 'mild' ? 'neutral' : 'warning'}
          className="ml-2"
        >
          {item.severity}
        </Badge>
      </>
    ),
  },
  {
    key: 'chronicConditions',
    title: 'Chronic conditions',
    icon: '🩺',
    empty: 'No chronic conditions recorded.',
    blank: { condition: '', diagnosedOn: '', status: 'active', notes: '' },
    fields: [
      { name: 'condition', label: 'Condition', required: true },
      { name: 'diagnosedOn', label: 'Diagnosed on', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: CONDITION_STATUS_OPTIONS },
      { name: 'notes', label: 'Notes' },
    ],
    render: (item) => (
      <>
        <span className="font-medium text-slate-900">{item.condition}</span>
        <Badge tone={item.status === 'active' ? 'warning' : 'success'} className="ml-2">
          {titleCase(item.status)}
        </Badge>
        {item.diagnosedOn && (
          <span className="ml-2 text-xs text-slate-500">since {formatDate(item.diagnosedOn)}</span>
        )}
        {item.notes && <p className="mt-0.5 text-sm text-slate-500">{item.notes}</p>}
      </>
    ),
  },
  {
    key: 'currentMedications',
    title: 'Current medications',
    icon: '💊',
    empty: 'No current medications recorded.',
    blank: { name: '', dosage: '', frequency: '', startedOn: '' },
    fields: [
      { name: 'name', label: 'Medication', required: true },
      { name: 'dosage', label: 'Dosage' },
      { name: 'frequency', label: 'Frequency' },
      { name: 'startedOn', label: 'Started on', type: 'date' },
    ],
    render: (item) => (
      <>
        <span className="font-medium text-slate-900">{item.name}</span>
        {item.dosage && <span className="text-slate-500"> · {item.dosage}</span>}
        {item.frequency && <span className="text-slate-500"> · {item.frequency}</span>}
        {item.startedOn && (
          <span className="ml-2 text-xs text-slate-500">from {formatDate(item.startedOn)}</span>
        )}
      </>
    ),
  },
  {
    key: 'pastSurgeries',
    title: 'Past surgeries',
    icon: '🔪',
    empty: 'No past surgeries recorded.',
    blank: { procedure: '', performedOn: '', hospital: '', notes: '' },
    fields: [
      { name: 'procedure', label: 'Procedure', required: true },
      { name: 'performedOn', label: 'Performed on', type: 'date' },
      { name: 'hospital', label: 'Hospital' },
      { name: 'notes', label: 'Notes' },
    ],
    render: (item) => (
      <>
        <span className="font-medium text-slate-900">{item.procedure}</span>
        {item.performedOn && (
          <span className="ml-2 text-xs text-slate-500">{formatDate(item.performedOn)}</span>
        )}
        {item.hospital && <span className="text-slate-500"> · {item.hospital}</span>}
        {item.notes && <p className="mt-0.5 text-sm text-slate-500">{item.notes}</p>}
      </>
    ),
  },
  {
    key: 'familyHistory',
    title: 'Family history',
    icon: '👪',
    empty: 'No family history recorded.',
    blank: { relation: '', condition: '', notes: '' },
    fields: [
      { name: 'relation', label: 'Relation', required: true },
      { name: 'condition', label: 'Condition', required: true },
      { name: 'notes', label: 'Notes' },
    ],
    render: (item) => (
      <>
        <span className="font-medium text-slate-900">{item.relation}</span>
        <span className="text-slate-500"> — {item.condition}</span>
        {item.notes && <p className="mt-0.5 text-sm text-slate-500">{item.notes}</p>}
      </>
    ),
  },
];

function Section({ section, patientId, initialItems, canEdit, onSaved }) {
  const [items, setItems] = useState(initialItems ?? []);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const persist = async (nextItems) => {
    setSaving(true);
    setError(null);
    try {
      // Dates come out of <input type="date"> as '' when blank — strip those.
      const cleaned = nextItems.map((item) =>
        Object.fromEntries(Object.entries(item).filter(([, v]) => v !== '' && v != null)),
      );
      const response = await patientsApi.updateMedicalHistory(patientId, {
        [section.key]: cleaned,
      });
      setItems(response.data[section.key] ?? []);
      setDraft(null);
      onSaved?.(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = (event) => {
    event.preventDefault();
    const missing = section.fields.filter((f) => f.required && !draft?.[f.name]?.trim());
    if (missing.length) {
      setError(`${missing.map((f) => f.label).join(' and ')} required`);
      return;
    }
    persist([...items, draft]);
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span aria-hidden="true">{section.icon}</span>
            {section.title}
            {items.length > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {items.length}
              </span>
            )}
          </span>
        }
        action={
          canEdit &&
          !draft && (
            <Button size="sm" variant="secondary" onClick={() => { setDraft({ ...section.blank }); setError(null); }}>
              + Add
            </Button>
          )
        }
      />

      {error && (
        <Alert tone="error" className="mb-3" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {items.length === 0 && !draft ? (
        <p className="py-3 text-sm text-slate-500">{section.empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item, index) => (
            <li key={item._id ?? index} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0 text-sm">{section.render(item)}</div>
              {canEdit && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => persist(items.filter((_, i) => i !== index))}
                  className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <form onSubmit={handleAdd} className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {section.fields.map((field) =>
              field.type === 'select' ? (
                <Select
                  key={field.name}
                  label={field.label}
                  options={field.options}
                  value={draft[field.name] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [field.name]: e.target.value })}
                />
              ) : (
                <Input
                  key={field.name}
                  label={field.label}
                  type={field.type ?? 'text'}
                  required={field.required}
                  value={draft[field.name] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [field.name]: e.target.value })}
                />
              ),
            )}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setError(null); }}>
              Cancel
            </Button>
            <Button size="sm" type="submit" loading={saving}>
              Save
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

export function MedicalHistoryTab({ patient, canEdit, onUpdated }) {
  const history = patient.medicalHistory ?? {};
  const [notes, setNotes] = useState(history.notes ?? '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesMessage, setNotesMessage] = useState(null);

  const saveNotes = async () => {
    setSavingNotes(true);
    setNotesMessage(null);
    try {
      const response = await patientsApi.updateMedicalHistory(patient._id, { notes });
      onUpdated?.(response.data);
      setNotesMessage({ tone: 'success', text: 'Notes saved.' });
    } catch (error) {
      setNotesMessage({ tone: 'error', text: error.message });
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <div className="space-y-4">
      {!canEdit && (
        <Alert tone="info">
          Your role has read-only access to clinical data. Contact a doctor or nurse to record
          changes.
        </Alert>
      )}

      {SECTIONS.map((section) => (
        <Section
          key={section.key}
          section={section}
          patientId={patient._id}
          initialItems={history[section.key]}
          canEdit={canEdit}
          onSaved={onUpdated}
        />
      ))}

      <Card>
        <CardHeader title="Clinical notes" description="Free-text summary for this patient" />
        {notesMessage && (
          <Alert tone={notesMessage.tone} className="mb-3" onDismiss={() => setNotesMessage(null)}>
            {notesMessage.text}
          </Alert>
        )}
        {canEdit ? (
          <>
            <Textarea
              rows={5}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="General clinical observations, background, ongoing concerns…"
            />
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={saveNotes} loading={savingNotes}>
                Save notes
              </Button>
            </div>
          </>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-slate-700">
            {history.notes || 'No notes recorded.'}
          </p>
        )}
      </Card>
    </div>
  );
}

export default MedicalHistoryTab;
