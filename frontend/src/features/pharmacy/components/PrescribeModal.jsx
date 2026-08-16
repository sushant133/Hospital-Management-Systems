import { useEffect, useState } from 'react';
import { pharmacyApi, ROUTE_OPTIONS } from '../../../api/pharmacyApi.js';
import { fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Input, Modal, Select, Spinner, Textarea,
} from '../../../components/ui/index.js';

const EMPTY_ITEM = {
  drugId: '', dosage: '', frequency: '', durationDays: '', route: '', instructions: '', quantity: '',
};

/**
 * Prescribe from a visit.
 *
 * Allergy warnings are shown here as well as at the counter: telling the
 * prescriber while they are still choosing is worth more than telling the
 * pharmacist an hour later. This one is advisory — the dispense-time check is
 * the gate.
 */
export function PrescribeModal({ open, onClose, patient, encounterId, onCreated }) {
  const [drugs, setDrugs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setItems([{ ...EMPTY_ITEM }]);
    setNotes('');
    setError(null);

    (async () => {
      setLoading(true);
      try {
        const response = await pharmacyApi.listDrugs({ limit: 200 });
        if (!cancelled) setDrugs(response.data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  const allergies = patient?.medicalHistory?.allergies ?? [];

  /**
   * Advisory client-side echo of the server's matcher: compares the recorded
   * allergy against the drug's declared allergen classes and names. The server
   * runs the authoritative check at dispense.
   */
  const warningsFor = (drugId) => {
    const drug = drugs.find((d) => String(d._id) === String(drugId));
    if (!drug) return [];
    const haystack = [
      ...(drug.allergenClasses ?? []),
      drug.genericName,
      drug.name,
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return allergies.filter((allergy) => {
      const substance = String(allergy.substance ?? '').toLowerCase();
      return substance && haystack.some((entry) => entry.includes(substance) || substance.includes(entry));
    });
  };

  const update = (index, key) => (event) => {
    const value = event.target.value;
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  };

  const submit = async () => {
    setError(null);

    const filled = items.filter((item) => item.drugId);
    if (!filled.length) return setError('Add at least one drug.');
    if (filled.some((item) => !item.dosage.trim() || !item.frequency.trim() || !item.quantity)) {
      return setError('Each item needs a dosage, a frequency and a quantity.');
    }

    setSaving(true);
    try {
      const response = await pharmacyApi.createPrescription({
        patientId: patient._id,
        encounterId,
        notes: notes.trim() || undefined,
        items: filled.map((item) => ({
          drugId: item.drugId,
          dosage: item.dosage.trim(),
          frequency: item.frequency.trim(),
          quantity: Number(item.quantity),
          durationDays: item.durationDays ? Number(item.durationDays) : undefined,
          route: item.route || undefined,
          instructions: item.instructions.trim() || undefined,
        })),
      });
      onCreated?.(response);
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
      title="Prescribe"
      description={patient ? `${fullName(patient)} · ${patient.mrn ?? ''}` : ''}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={submit} disabled={loading}>Sign prescription</Button>
        </>
      }
    >
      {loading ? (
        <Spinner label="Loading the formulary…" className="py-10" />
      ) : (
        <div className="space-y-4">
          {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

          {allergies.length > 0 && (
            <Alert tone="warning" title="Recorded allergies">
              {allergies.map((a) => a.substance).join(', ')}
            </Alert>
          )}

          {items.map((item, index) => {
            const warnings = warningsFor(item.drugId);
            return (
              <div key={index} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Item {index + 1}</span>
                  {items.length > 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove
                    </Button>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label="Drug"
                    placeholder="Select a drug"
                    value={item.drugId}
                    onChange={update(index, 'drugId')}
                    options={drugs.map((drug) => ({
                      value: drug._id,
                      label: `${drug.name} ${drug.strength} (${drug.quantityOnHand} in stock)`,
                    }))}
                    required
                  />
                  <Input label="Quantity to supply" type="number" min="1" value={item.quantity} onChange={update(index, 'quantity')} required />
                  <Input label="Dosage" placeholder="1 capsule" value={item.dosage} onChange={update(index, 'dosage')} required />
                  <Input label="Frequency" placeholder="three times a day" value={item.frequency} onChange={update(index, 'frequency')} required />
                  <Input label="Duration (days)" type="number" min="0" value={item.durationDays} onChange={update(index, 'durationDays')} />
                  <Select label="Route" placeholder="Drug default" options={ROUTE_OPTIONS} value={item.route} onChange={update(index, 'route')} />
                </div>

                <div className="mt-3">
                  <Input label="Instructions" placeholder="After food" value={item.instructions} onChange={update(index, 'instructions')} />
                </div>

                {warnings.length > 0 && (
                  <Alert tone="error" className="mt-3" title="Allergy warning">
                    This patient is recorded as allergic to{' '}
                    {warnings.map((w) => (
                      <Badge key={w.substance} tone="danger">{w.substance}</Badge>
                    ))}
                    . You may still prescribe, but the pharmacist will have to override the block to
                    dispense it.
                  </Alert>
                )}
              </div>
            );
          })}

          <Button variant="secondary" size="sm" onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}>
            Add another drug
          </Button>

          <Textarea label="Notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Complete the full course…" />
        </div>
      )}
    </Modal>
  );
}

export default PrescribeModal;
