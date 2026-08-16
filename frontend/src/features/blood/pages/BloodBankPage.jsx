import { useCallback, useEffect, useState } from 'react';
import { bloodApi } from '../../../api/tier23Api.js';
import { patientsApi } from '../../../api/patientApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Input, Modal, PageHeader, Select, Spinner,
  Table, TBody, TD, THead, TR, TRMessage, Textarea,
} from '../../../components/ui/index.js';

const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const COMPONENTS = ['wb', 'prbc', 'ffp', 'platelet', 'cryo'];

export function BloodBankPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState('units');
  const [units, setUnits] = useState([]);
  const [reqs, setReqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [unitForm, setUnitForm] = useState({ group: 'O+', component: 'prbc', expiresAt: '' });
  const [reqOpen, setReqOpen] = useState(false);
  const [reqForm, setReqForm] = useState({ patientId: '', encounterId: '', group: 'O+', component: 'prbc', unitsRequested: 1, indication: '' });
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState([]);
  const [visits, setVisits] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'units') setUnits((await bloodApi.listUnits({ limit: 100 })).data);
      else setReqs((await bloodApi.listRequests({ limit: 100 })).data);
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

  const register = async () => {
    try {
      const response = await bloodApi.registerUnit(unitForm);
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const raise = async () => {
    try {
      const response = await bloodApi.createRequest({ ...reqForm, unitsRequested: Number(reqForm.unitsRequested) });
      setNotice(response.message);
      setReqOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const pickPatient = async (p) => {
    setReqForm((f) => ({ ...f, patientId: p._id, group: p.bloodGroup && p.bloodGroup !== 'unknown' ? p.bloodGroup : f.group }));
    setSearch(`${fullName(p)} (${p.mrn})`);
    setMatches([]);
    const vis = await patientsApi.encounters(p._id, { limit: 10 }).catch(() => ({ data: [] }));
    setVisits(vis.data ?? []);
  };

  return (
    <div>
      <PageHeader
        title="Blood bank"
        description="Stock bags, requests, crossmatch and issue."
        action={tab === 'units' && can(MODULES.BLOOD_BANK, 'manageUnits') && <Button onClick={register}>Register unit</Button>}
      />
      <div className="mb-4 flex gap-2">
        <Button variant={tab === 'units' ? 'primary' : 'secondary'} onClick={() => setTab('units')}>Units</Button>
        <Button variant={tab === 'req' ? 'primary' : 'secondary'} onClick={() => setTab('req')}>Requests</Button>
        {tab === 'req' && can(MODULES.BLOOD_BANK, 'request') && (
          <Button onClick={() => setReqOpen(true)}>New request</Button>
        )}
      </div>
      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      {tab === 'units' && can(MODULES.BLOOD_BANK, 'manageUnits') && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Select label="Group" value={unitForm.group} onChange={(e) => setUnitForm((f) => ({ ...f, group: e.target.value }))}>
            {GROUPS.map((g) => <option key={g}>{g}</option>)}
          </Select>
          <Select label="Component" value={unitForm.component} onChange={(e) => setUnitForm((f) => ({ ...f, component: e.target.value }))}>
            {COMPONENTS.map((g) => <option key={g}>{g}</option>)}
          </Select>
          <Input label="Expires" type="date" value={unitForm.expiresAt} onChange={(e) => setUnitForm((f) => ({ ...f, expiresAt: e.target.value }))} />
        </div>
      )}

      {loading ? <Spinner className="py-12" /> : tab === 'units' ? (
        <Table>
          <THead columns={[{ key: 'b', label: 'Bag' }, { key: 'g', label: 'Group' }, { key: 'e', label: 'Expires' }, { key: 's', label: 'Status' }]} />
          <TBody>
            {units.map((u) => (
              <TR key={u._id}>
                <TD className="font-mono text-xs">{u.bagNumber}</TD>
                <TD>{u.group} · {u.component}</TD>
                <TD>{formatDate(u.expiresAt)}</TD>
                <TD><Badge>{u.status}</Badge></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <Table>
          <THead columns={[{ key: 'r', label: 'Request' }, { key: 'p', label: 'Patient' }, { key: 'n', label: 'Need' }, { key: 's', label: 'Status' }, { key: 'a', label: '' }]} />
          <TBody>
            {reqs.map((r) => (
              <TR key={r._id}>
                <TD className="font-mono text-xs">{r.requestNumber}</TD>
                <TD>{fullName(r.patientId)}</TD>
                <TD>{r.unitsRequested} × {r.component} {r.group}</TD>
                <TD><Badge>{r.status}</Badge></TD>
                <TD>
                  {r.status === 'crossmatched' && can(MODULES.BLOOD_BANK, 'issue') && (
                    <Button size="sm" onClick={async () => { try { setNotice((await bloodApi.issue(r._id)).message); load(); } catch (e) { setError(e.message); } }}>Issue</Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal open={reqOpen} onClose={() => setReqOpen(false)} title="Blood request" footer={<Button onClick={raise}>Raise</Button>}>
        <Input label="Patient" value={search} onChange={(e) => setSearch(e.target.value)} />
        {matches.map((p) => (
          <button key={p._id} type="button" className="mt-1 block w-full text-left text-sm hover:bg-slate-50" onClick={() => pickPatient(p)}>
            {fullName(p)} {p.mrn}
          </button>
        ))}
        <Select className="mt-3" label="Visit" value={reqForm.encounterId} onChange={(e) => setReqForm((f) => ({ ...f, encounterId: e.target.value }))}>
          <option value="">Select…</option>
          {visits.map((v) => <option key={v._id} value={v._id}>{v.encounterNumber}</option>)}
        </Select>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Select label="Group" value={reqForm.group} onChange={(e) => setReqForm((f) => ({ ...f, group: e.target.value }))}>
            {GROUPS.map((g) => <option key={g}>{g}</option>)}
          </Select>
          <Select label="Component" value={reqForm.component} onChange={(e) => setReqForm((f) => ({ ...f, component: e.target.value }))}>
            {COMPONENTS.map((g) => <option key={g}>{g}</option>)}
          </Select>
        </div>
        <Textarea className="mt-3" label="Indication" value={reqForm.indication} onChange={(e) => setReqForm((f) => ({ ...f, indication: e.target.value }))} />
      </Modal>
    </div>
  );
}

export default BloodBankPage;
