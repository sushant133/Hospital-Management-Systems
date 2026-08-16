import { useCallback, useEffect, useState } from 'react';
import { facilityApi } from '../../../api/tier23Api.js';
import { Alert, Badge, PageHeader, Spinner, Table, TBody, TD, THead, TR, TRMessage } from '../../../components/ui/index.js';

export function FacilitiesPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await facilityApi.list({ limit: 50 })).data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="Facilities" description="Campuses sharing this MPI. The switcher in the top bar sets X-Facility-Id on later requests." />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {loading ? <Spinner className="py-12" /> : (
        <Table>
          <THead columns={[{ key: 'c', label: 'Code' }, { key: 'n', label: 'Name' }, { key: 'k', label: 'Kind' }]} />
          <TBody>
            {rows.map((f) => (
              <TR key={f._id}>
                <TD>
                  {f.code}
                  {f.isDefault && <Badge tone="info" className="ml-2">default</Badge>}
                </TD>
                <TD>{f.name}</TD>
                <TD>{f.kind}</TD>
              </TR>
            ))}
            {rows.length === 0 && <TRMessage colSpan={3}>No facilities seeded.</TRMessage>}
          </TBody>
        </Table>
      )}
    </div>
  );
}

export default FacilitiesPage;
