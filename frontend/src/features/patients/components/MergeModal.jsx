import { useEffect, useState } from 'react';
import { patientsApi } from '../../../api/patientApi.js';
import { fullName } from '../../../utils/format.js';
import { Alert, Button, Input, Modal, Textarea } from '../../../components/ui/index.js';

/**
 * Absorb a duplicate chart into the open one. Irreversible from the UI —
 * the losing MRN stays resolvable, children are re-pointed.
 */
export function MergeModal({ open, onClose, target, onMerged }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [source, setSource] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setResults([]);
      setSource(null);
      setReason('');
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await patientsApi.list({ search: term, limit: 8 });
        setResults((response.data ?? []).filter((p) => p._id !== target?._id && p.status !== 'merged'));
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, target?._id]);

  const submit = async () => {
    if (!source) return setError('Choose the chart to absorb.');
    if (reason.trim().length < 10) return setError('Give a merge reason of at least 10 characters.');
    setSaving(true);
    setError(null);
    try {
      const response = await patientsApi.merge(target._id, { sourceId: source._id, reason: reason.trim() });
      onMerged?.(response);
      onClose?.();
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
      title="Merge duplicate chart"
      description={`Keep ${target?.mrn} (${fullName(target)}). The other MRN is closed and every child document is re-pointed here.`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={saving} onClick={submit} disabled={!source}>
            Merge into {target?.mrn}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="error" className="mb-3" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Input
        label="Find the duplicate"
        placeholder="MRN, name or phone"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {results.length > 0 && (
        <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
          {results.map((row) => (
            <li key={row._id}>
              <button
                type="button"
                onClick={() => setSource(row)}
                className={[
                  'flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                  source?._id === row._id ? 'bg-brand-50' : 'hover:bg-slate-50',
                ].join(' ')}
              >
                <span>
                  <span className="font-medium text-slate-900">{fullName(row)}</span>
                  <span className="ml-2 font-mono text-xs text-slate-500">{row.mrn}</span>
                </span>
                <span className="text-xs text-slate-400">{row.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {source && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Absorbing <strong>{source.mrn}</strong> ({fullName(source)}) into <strong>{target.mrn}</strong>.
          This cannot be undone from the UI.
        </p>
      )}

      <Textarea
        className="mt-3"
        label="Reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Same person registered twice at reception — confirmed by national ID…"
      />
    </Modal>
  );
}

export default MergeModal;
