import { useCallback, useEffect, useState } from 'react';
import { deviceApi, warehouseApi } from '../../../api/tier23Api.js';
import { formatDate } from '../../../utils/format.js';
import { Alert, Badge, PageHeader, Spinner, Table, TBody, TD, THead, TR, TRMessage } from '../../../components/ui/index.js';

export function DevicesPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await deviceApi.list({ limit: 100 })).data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="Devices" description="Analyzers and modalities. An HL7 ingest updates last-seen when the sending application matches." />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {loading ? <Spinner className="py-12" /> : (
        <Table>
          <THead columns={[{ key: 'c', label: 'Code' }, { key: 'n', label: 'Name' }, { key: 'k', label: 'Kind' }, { key: 's', label: 'Sender' }, { key: 'l', label: 'Last seen' }]} />
          <TBody>
            {rows.length === 0 && <TRMessage colSpan={5}>No devices.</TRMessage>}
            {rows.map((d) => (
              <TR key={d._id}>
                <TD>{d.code}</TD>
                <TD>{d.name}</TD>
                <TD><Badge>{d.kind}</Badge></TD>
                <TD className="font-mono text-xs">{d.sendingApplication || '—'}</TD>
                <TD>{d.lastSeenAt ? formatDate(d.lastSeenAt, { withTime: true }) : '—'}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

export function WarehousePage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await warehouseApi.list({ limit: 30 })).data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Daily warehouse"
        description="Rolled-up facts for the night job. Rebuild today if the job has not run."
        action={
          <button
            type="button"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
            onClick={async () => {
              try {
                setNotice((await warehouseApi.rebuild({})).message);
                load();
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Rebuild today
          </button>
        }
      />
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {loading ? <Spinner className="py-12" /> : (
        <Table>
          <THead columns={[{ key: 'd', label: 'Date' }, { key: 'e', label: 'Visits' }, { key: 'i', label: 'Invoices' }, { key: 'p', label: 'Payments' }, { key: 'l', label: 'Lab' }]} />
          <TBody>
            {rows.length === 0 && <TRMessage colSpan={5}>No snapshots yet.</TRMessage>}
            {rows.map((r) => (
              <TR key={r._id || r.date}>
                <TD>{formatDate(r.date)}</TD>
                <TD>{r.encountersOpened}</TD>
                <TD>{r.invoicesIssued} / {r.invoiceTotal}</TD>
                <TD>{r.paymentsTotal}</TD>
                <TD>{r.labOrders}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

export default DevicesPage;
