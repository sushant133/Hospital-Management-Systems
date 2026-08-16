import { useCallback, useEffect, useState } from 'react';
import { maternityApi } from '../../../api/tier23Api.js';
import { patientsApi } from '../../../api/patientApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Input, Modal, PageHeader, Select, Spinner,
  Table, TBody, TD, THead, TR, TRMessage, Textarea,
} from '../../../components/ui/index.js';

export function MaternityPage() {
  const { can } = useAuth();
  const canCreate = can(MODULES.MATERNITY, 'create');
  const [tab, setTab] = useState('anc');
  const [rows, setRows] = useState([]);
  const [imms, setImms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ patientId: '', lmp: '', gravida: 1, para: 0 });
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'anc') {
        setRows((await maternityApi.listCases({ limit: 100 })).data);
      } else {
        setImms((await maternityApi.listImmunizations({ limit: 100 })).data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) return undefined;
    const t = setTimeout(async () => {
      const res = await patientsApi.list({ search: term, limit: 8 }).catch(() => ({ data: [] }));
      setMatches(res.data);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const create = async () => {
    if (!form.patientId || !form.lmp) return setError('Patient and LMP are required.');
    setSaving(true);
    try {
      const response = await maternityApi.createCase({
        patientId: form.patientId,
        lmp: form.lmp,
        gravida: Number(form.gravida || 1),
        para: Number(form.para || 0),
      });
      setNotice(response.message);
      setOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Maternity & immunization"
        description="ANC cases, high-risk flags, and vaccine doses."
        action={canCreate && tab === 'anc' && <Button onClick={() => setOpen(true)}>Open ANC case</Button>}
      />
      <div className="mb-4 flex gap-2">
        <Button variant={tab === 'anc' ? 'primary' : 'secondary'} onClick={() => setTab('anc')}>ANC</Button>
        <Button variant={tab === 'imm' ? 'primary' : 'secondary'} onClick={() => setTab('imm')}>Immunizations</Button>
      </div>
      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}
      {loading ? <Spinner className="py-12" /> : tab === 'anc' ? (
        <Table>
          <THead columns={[{ key: 'c', label: 'Case' }, { key: 'p', label: 'Patient' }, { key: 'e', label: 'EDD' }, { key: 's', label: 'Status' }]} />
          <TBody>
            {rows.length === 0 && <TRMessage colSpan={4}>No cases.</TRMessage>}
            {rows.map((row) => (
              <TR key={row._id}>
                <TD>
                  <div className="font-mono text-xs">{row.caseNumber}</div>
                  {row.highRisk && <Badge tone="danger">high risk</Badge>}
                </TD>
                <TD>{fullName(row.patientId)}</TD>
                <TD>{formatDate(row.edd)}</TD>
                <TD><Badge>{row.status}</Badge></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <Table>
          <THead columns={[{ key: 'v', label: 'Vaccine' }, { key: 'p', label: 'Patient' }, { key: 'd', label: 'Given' }]} />
          <TBody>
            {imms.length === 0 && <TRMessage colSpan={3}>No doses recorded.</TRMessage>}
            {imms.map((row) => (
              <TR key={row._id}>
                <TD>{row.vaccineName} · dose {row.doseNumber}</TD>
                <TD>{fullName(row.patientId)}</TD>
                <TD>{formatDate(row.givenAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Open ANC case" footer={<Button loading={saving} onClick={create}>Create</Button>}>
        <Input label="Patient" value={search} onChange={(e) => setSearch(e.target.value)} />
        {matches.map((p) => (
          <button key={p._id} type="button" className="mt-1 block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-50" onClick={() => { setForm((f) => ({ ...f, patientId: p._id })); setSearch(`${fullName(p)} (${p.mrn})`); setMatches([]); }}>
            {fullName(p)} {p.mrn}
          </button>
        ))}
        <Input className="mt-3" label="LMP" type="date" value={form.lmp} onChange={(e) => setForm((f) => ({ ...f, lmp: e.target.value }))} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Input label="Gravida" type="number" value={form.gravida} onChange={(e) => setForm((f) => ({ ...f, gravida: e.target.value }))} />
          <Input label="Para" type="number" value={form.para} onChange={(e) => setForm((f) => ({ ...f, para: e.target.value }))} />
        </div>
      </Modal>
    </div>
  );
}

export default MaternityPage;
