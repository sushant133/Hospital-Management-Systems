import { useEffect, useState } from 'react';
import { ehrApi, NOTE_TYPE_OPTIONS } from '../../../api/ehrApi.js';
import { Alert, Button, Card, CardHeader, Select, Textarea } from '../../../components/ui/index.js';

const SOAP_SECTIONS = [
  { key: 'subjective', label: 'Subjective', hint: 'What the patient reports — history, symptoms, concerns.' },
  { key: 'objective', label: 'Objective', hint: 'What you observed and measured — examination findings, results.' },
  { key: 'assessment', label: 'Assessment', hint: 'Your clinical impression or differential.' },
  { key: 'plan', label: 'Plan', hint: 'Investigations, treatment, follow-up.' },
];

const EMPTY = { subjective: '', objective: '', assessment: '', plan: '', content: '' };

/**
 * Write a note, or amend one.
 *
 * Signing is final — there is no draft state and no edit, because a note that
 * can be revised in place is not a record of what was known at the time. An
 * amendment writes a NEW version linked to this one, with a mandatory reason,
 * and both stay readable. The form says so before the author commits.
 */
export function SoapNoteEditor({ encounterId, amending, disabled, onSaved, onCancel }) {
  const [noteType, setNoteType] = useState(amending?.noteType ?? 'soap');
  const [form, setForm] = useState(EMPTY);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (amending) {
      setNoteType(amending.noteType);
      setForm({
        subjective: amending.subjective ?? '',
        objective: amending.objective ?? '',
        assessment: amending.assessment ?? '',
        plan: amending.plan ?? '',
        content: amending.content ?? '',
      });
      setReason('');
    } else {
      setForm(EMPTY);
    }
    setError(null);
  }, [amending]);

  const update = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
    setError(null);
  };

  const isSoap = noteType === 'soap';

  const submit = async () => {
    setError(null);

    const hasSoap = SOAP_SECTIONS.some((section) => form[section.key].trim());
    const hasContent = form.content.trim();

    if (isSoap && !hasSoap) {
      return setError('A SOAP note needs at least one of subjective, objective, assessment or plan.');
    }
    if (!isSoap && !hasContent) {
      return setError('Write the note before signing.');
    }
    if (amending && reason.trim().length < 10) {
      return setError('Give a reason of at least 10 characters for the amendment.');
    }

    const payload = isSoap
      ? {
          subjective: form.subjective.trim(),
          objective: form.objective.trim(),
          assessment: form.assessment.trim(),
          plan: form.plan.trim(),
        }
      : { content: form.content.trim() };

    setSaving(true);
    try {
      const response = amending
        ? await ehrApi.amendNote(amending._id, { ...payload, amendmentReason: reason.trim() })
        : await ehrApi.createNote({ ...payload, encounterId, noteType });

      setForm(EMPTY);
      setReason('');
      onSaved?.(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (disabled) {
    return (
      <Card>
        <CardHeader title="Clinical note" />
        <Alert tone="neutral">
          This visit is closed; notes can no longer be added to it.
        </Alert>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={amending ? `Amend note (version ${amending.version})` : 'New clinical note'}
        description={
          amending
            ? 'This writes a new version. The version you are correcting stays on the record.'
            : 'Signing is final. Corrections are made by amending, which keeps both versions.'
        }
        action={
          amending && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )
        }
      />

      {error && (
        <Alert tone="error" className="mb-3" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!amending && (
        <div className="mb-3 w-56">
          <Select
            label="Note type"
            options={NOTE_TYPE_OPTIONS}
            value={noteType}
            onChange={(event) => setNoteType(event.target.value)}
          />
        </div>
      )}

      {isSoap ? (
        <div className="space-y-3">
          {SOAP_SECTIONS.map((section) => (
            <Textarea
              key={section.key}
              label={section.label}
              hint={section.hint}
              rows={3}
              value={form[section.key]}
              onChange={update(section.key)}
            />
          ))}
        </div>
      ) : (
        <Textarea
          label="Note"
          rows={8}
          value={form.content}
          onChange={update('content')}
          placeholder="Write the note…"
        />
      )}

      {amending && (
        <div className="mt-3">
          <Textarea
            label="Reason for amendment"
            required
            rows={2}
            hint="Recorded permanently against both versions and in the audit trail."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Chest X-ray returned after signing; diagnosis corrected."
          />
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button loading={saving} onClick={submit}>
          {amending ? 'Sign amendment' : 'Sign note'}
        </Button>
      </div>
    </Card>
  );
}

export default SoapNoteEditor;
