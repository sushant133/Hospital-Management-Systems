import { useCallback, useEffect, useState } from 'react';
import { hieApi } from '../../../api/tier23Api.js';
import { patientsApi } from '../../../api/patientApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Input, Modal, PageHeader, Select, Spinner,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

export function HiePage() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ patientId: '', purpose: 'hie' });
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await hieApi.listConsents({ limit: 100 })).data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) return undefined;
    const t = setTimeout(async () => {
      setMatches((await patientsApi.list({ search: term, limit: 8 }).catch(() => ({ data: [] }))).data);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const grant = async () => {
    try {
      const response = await hieApi.grant(form);
      setNotice(response.message);
      setOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <PageHeader
        title="HIE consent"
        description="Hospital-side consent artefacts. Not a certified ABDM consent manager — required before a visit bundle can be exported."
        action={can(MODULES.HIE, 'consent') && <Button onClick={() => setOpen(true)}>Record consent</Button>}
      />
      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}
      {loading ? <Spinner className="py-12" /> : (
        <Table>
          <THead columns={[{ key: 'p', label: 'Patient' }, { key: 'u', label: 'Purpose' }, { key: 's', label: 'Status' }, { key: 'd', label: 'Granted' }, { key: 'a', label: '' }]} />
          <TBody>
            {rows.length === 0 && <TRMessage colSpan={5}>No consents.</TRMessage>}
            {rows.map((row) => (
              <TR key={row._id}>
                <TD>{fullName(row.patientId)}</TD>
                <TD>{row.purpose}</TD>
                <TD><Badge tone={row.status === 'active' ? 'success' : 'neutral'}>{row.status}</Badge></TD>
                <TD>{formatDate(row.grantedAt)}</TD>
                <TD>
                  {row.status === 'active' && can(MODULES.HIE, 'consent') && (
                    <Button size="sm" variant="secondary" onClick={async () => { try { setNotice((await hieApi.revoke(row._id)).message); load(); } catch (e) { setError(e.message); } }}>Revoke</Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Record consent" footer={<Button onClick={grant}>Save</Button>}>
        <Input label="Patient" value={search} onChange={(e) => setSearch(e.target.value)} />
        {matches.map((p) => (
          <button key={p._id} type="button" className="mt-1 block w-full text-left text-sm hover:bg-slate-50" onClick={() => { setForm((f) => ({ ...f, patientId: p._id })); setSearch(`${fullName(p)} (${p.mrn})`); setMatches([]); }}>
            {fullName(p)} {p.mrn}
          </button>
        ))}
        <Select className="mt-3" label="Purpose" value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}>
          <option value="hie">HIE</option>
          <option value="referral">Referral</option>
          <option value="treatment">Treatment</option>
          <option value="research">Research</option>
        </Select>
      </Modal>
    </div>
  );
}

export default HiePage;
