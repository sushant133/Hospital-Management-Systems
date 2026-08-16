import { useEffect, useState } from 'react';
import { payrollApi } from '../../../api/payrollApi.js';
import { Alert, Button, Input, Modal, Select, Textarea } from '../../../components/ui/index.js';

const blankLine = () => ({ label: '', amount: '', percentOfBasic: '' });

/**
 * Editor for a list of allowance or deduction lines.
 *
 * Declared at module scope, not inside the modal: a component defined during
 * render is a new type every render, so React would unmount and remount these
 * inputs on every keystroke and the caret would jump out of the field.
 *
 * Amount and percentage disable each other — a line is one or the other, which
 * is what the server's validator enforces too.
 */
function LineEditor({ title, hint, lines, onChange }) {
  const edit = (index, field, value) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, [field]: value } : line)));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">{title}</p>
        <Button size="sm" variant="secondary" onClick={() => onChange([...lines, blankLine()])}>
          Add
        </Button>
      </div>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>
      <div className="space-y-2">
        {lines.length === 0 && <p className="text-xs text-slate-400">None.</p>}
        {lines.map((line, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={index} className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                aria-label={`${title} label`}
                placeholder="Housing"
                value={line.label}
                onChange={(event) => edit(index, 'label', event.target.value)}
              />
            </div>
            <div className="w-24">
              <Input
                aria-label={`${title} amount`}
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount"
                value={line.amount}
                disabled={Number(line.percentOfBasic) > 0}
                onChange={(event) => edit(index, 'amount', event.target.value)}
              />
            </div>
            <div className="w-20">
              <Input
                aria-label={`${title} percent of basic`}
                type="number"
                min="0"
                max="100"
                placeholder="%"
                value={line.percentOfBasic}
                disabled={Number(line.amount) > 0}
                onChange={(event) => edit(index, 'percentOfBasic', event.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              aria-label={`Remove ${line.label || 'line'}`}
              onClick={() => onChange(lines.filter((_, i) => i !== index))}
            >
              ✕
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Setting someone's pay.
 *
 * A rise never edits the structure in place — it creates a new one from a date,
 * and the server closes the previous one the day before. That is why there is a
 * single "effective from" field and no way to amend history: a payslip issued
 * last March must still be explicable from the structure it was computed on.
 */
export function SalaryStructureModal({ open, staff, onClose, onDone }) {
  const [userId, setUserId] = useState('');
  const [basicSalary, setBasicSalary] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [allowances, setAllowances] = useState([blankLine()]);
  const [deductions, setDeductions] = useState([]);
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [notes, setNotes] = useState('');

  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUserId('');
    setBasicSalary('');
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setAllowances([blankLine()]);
    setDeductions([]);
    setBankName('');
    setBankAccount('');
    setNotes('');
    setError(null);
  }, [open]);

  /** Drop empty rows and send an amount OR a percentage, never both. */
  const cleanLines = (lines) =>
    lines
      .filter((line) => line.label.trim() && (Number(line.amount) > 0 || Number(line.percentOfBasic) > 0))
      .map((line) =>
        Number(line.percentOfBasic) > 0
          ? { label: line.label.trim(), percentOfBasic: Number(line.percentOfBasic) }
          : { label: line.label.trim(), amount: Number(line.amount) },
      );

  const submit = async () => {
    setError(null);
    if (!userId) return setError('Choose a staff member.');
    if (!(Number(basicSalary) >= 0)) return setError('Enter a basic salary.');
    if (!effectiveFrom) return setError('Choose the date this pay takes effect.');

    setSaving(true);
    try {
      const response = await payrollApi.createStructure({
        userId,
        basicSalary: Number(basicSalary),
        allowances: cleanLines(allowances),
        deductions: cleanLines(deductions),
        bankName: bankName.trim() || undefined,
        bankAccount: bankAccount.trim() || undefined,
        notes: notes.trim() || undefined,
        effectiveFrom: new Date(effectiveFrom).toISOString(),
      });
      onDone?.(response);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Set salary structure"
      description="Creates a new structure from the chosen date and closes the previous one."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={submit}>Save structure</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

        <Select
          label="Staff member"
          required
          placeholder="Choose…"
          options={staff.map((person) => ({
            value: person._id,
            label: `${person.firstName} ${person.lastName} — ${person.role}`,
          }))}
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Basic salary (per month)"
            type="number"
            min="0"
            step="0.01"
            required
            value={basicSalary}
            onChange={(event) => setBasicSalary(event.target.value)}
          />
          <Input
            label="Effective from"
            type="date"
            required
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            hint="Back-dating is refused."
          />
        </div>

        <LineEditor
          title="Allowances"
          lines={allowances}
          onChange={setAllowances}
          hint="Flat amounts are paid in full regardless of attendance; percentages follow the pro-rated basic."
        />

        <LineEditor
          title="Deductions"
          lines={deductions}
          onChange={setDeductions}
          hint="Deductions never take net pay below zero."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Bank"
            value={bankName}
            onChange={(event) => setBankName(event.target.value)}
          />
          <Input
            label="Account number"
            value={bankAccount}
            onChange={(event) => setBankAccount(event.target.value)}
          />
        </div>

        <Textarea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
    </Modal>
  );
}

export default SalaryStructureModal;
