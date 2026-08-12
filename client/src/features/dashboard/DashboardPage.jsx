import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/apiClient.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { MODULES } from '../../app/permissions.js';
import { fullName, formatDate } from '../../lib/format.js';
import { Alert, Card, CardHeader, PageHeader, Spinner, StatCard, Badge } from '../../components/ui/index.js';

export function DashboardPage() {
  const { user, can } = useAuth();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const canReadPatients = can(MODULES.PATIENTS, 'view');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Phase 0/1 has no dedicated stats endpoint — derive the numbers from
        // list metadata. Phase 10 replaces this with a reporting endpoint.
        const requests = [api.get('/departments', { params: { limit: 100 } }), api.get('/wards', { params: { limit: 100 } })];
        if (canReadPatients) {
          requests.push(api.get('/patients', { params: { limit: 5, sort: '-createdAt' } }));
          requests.push(api.get('/encounters', { params: { limit: 1, status: 'open' } }));
        }

        const [departments, wards, patients, openVisits] = await Promise.all(requests);
        if (cancelled) return;

        const beds = wards.data.reduce(
          (acc, ward) => {
            acc.total += ward.occupancy?.total ?? 0;
            acc.available += ward.occupancy?.available ?? 0;
            acc.occupied += ward.occupancy?.occupied ?? 0;
            return acc;
          },
          { total: 0, available: 0, occupied: 0 },
        );

        setStats({
          departments: departments.meta?.total ?? departments.data.length,
          wards: wards.meta?.total ?? wards.data.length,
          beds,
          patients: patients?.meta?.total ?? null,
          openVisits: openVisits?.meta?.total ?? null,
        });
        setRecent(patients?.data ?? []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canReadPatients]);

  const occupancyRate =
    stats?.beds.total > 0 ? Math.round((stats.beds.occupied / stats.beds.total) * 100) : 0;

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.firstName ?? 'there'}`}
        description="Here's the current state of the hospital."
      />

      {error && (
        <Alert tone="error" title="Could not load dashboard" className="mb-6">
          {error}
        </Alert>
      )}

      {loading ? (
        <Spinner label="Loading dashboard…" className="py-16" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {canReadPatients && (
              <StatCard label="Registered patients" value={stats?.patients ?? '—'} tone="brand" />
            )}
            {canReadPatients && (
              <StatCard label="Open visits" value={stats?.openVisits ?? '—'} tone="amber" hint="Currently in progress" />
            )}
            <StatCard label="Departments" value={stats?.departments ?? 0} tone="slate" />
            <StatCard
              label="Beds available"
              value={`${stats?.beds.available ?? 0} / ${stats?.beds.total ?? 0}`}
              tone="emerald"
              hint={`${occupancyRate}% occupancy across ${stats?.wards ?? 0} wards`}
            />
          </div>

          {canReadPatients && (
            <Card className="mt-6">
              <CardHeader
                title="Recently registered patients"
                description="The five most recent registrations"
                action={
                  <Link to="/patients" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                    View all →
                  </Link>
                }
              />
              {recent.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No patients registered yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recent.map((patient) => (
                    <li key={patient._id}>
                      <Link
                        to={`/patients/${patient._id}`}
                        className="flex items-center justify-between gap-4 py-3 hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {fullName(patient)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {patient.mrn} · registered {formatDate(patient.createdAt)}
                          </p>
                        </div>
                        <Badge tone={patient.status === 'active' ? 'success' : 'neutral'}>
                          {patient.status}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card className="mt-6 border-dashed bg-slate-50/60">
            <CardHeader
              title="Build status"
              description="Phases 0 and 1 are live. Later modules appear in the sidebar as they are built."
            />
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone="success">Phase 0 · Foundation</Badge>
              <Badge tone="success">Phase 1 · Patients & Facilities</Badge>
              <Badge tone="neutral">Phase 2 · Appointments</Badge>
              <Badge tone="neutral">Phase 3 · Admissions</Badge>
              <Badge tone="neutral">Phase 4+ · Lab, Radiology, Pharmacy, Billing…</Badge>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default DashboardPage;
