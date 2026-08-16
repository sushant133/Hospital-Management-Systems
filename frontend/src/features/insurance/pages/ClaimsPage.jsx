import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  insuranceApi,
  CLAIM_STATUS_OPTIONS,
  CLAIM_STATUS_TONES,
  BUCKET_TONES,
  claimActions,
} from '../../../api/insuranceApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import ClaimDecisionModal from '../components/ClaimDecisionModal.jsx';
import {
  Alert, Badge, Button, Card, CardHeader, PageHeader, Select, Spinner,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'claim', label: 'Claim' },
  { key: 'patient', label: 'Patient' },
  { key: 'insurer', label: 'Insurer / TPA' },
  { key: 'amounts', label: 'Claimed / approved' },
  { key: 'age', label: 'Age' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '' },
];

const TABS = [
  { key: 'claims', label: 'Claims' },
  { key: 'aging', label: 'Aging' },
  { key: 'settlement', label: 'Settlement' },
];

/**
 * The claims desk: what has been sent to insurers, what they have agreed, and
 * how old the money is.
 */
export function ClaimsPage() {
  const { can } = useAuth();
  const canSubmit = can(MODULES.CLAIMS, 'submit');
  const canDecide = can(MODULES.CLAIMS, 'recordDecision');

  const [tab, setTab] = useState('claims');
  const [status, setStatus] = useState('');
  const [openOnly, setOpenOnly] = useState(false);

  const [claims, setClaims] = useState([]);
  const [aging, setAging] = useState(null);
  const [settlement, setSettlement] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [modal, setModal] = useState({ action: null, claim: null });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'claims') {
        const response = await insuranceApi.listClaims({
          status: status || undefined,
          openOnly: openOnly && !status ? 'true' : undefined,
          limit: 100,
        });
        setClaims(response.data);
      } else if (tab === 'aging') {
        setAging(await insuranceApi.aging({}));
      } else {
        setSettlement(await insuranceApi.settlement({}));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tab, status, openOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (claim) => {
    setBusyId(claim._id);
    setError(null);
    try {
      const response = await insuranceApi.submitClaim(claim._id, {});
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const ACTION_LABELS = {
    submit: 'Submit',
    resubmit: 'Resubmit',
    decision: 'Record decision',
    settle: 'Settle',
  };

  return (
    <div>
      <PageHeader
        title="Insurance claims"
        description="Claims with insurers, what they have agreed, and what is still owed."
        action={
          <Link to="/insurance/policies">
            <Button variant="secondary">Policies</Button>
          </Link>
        }
      />

      {notice && (
        <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="mb-4 border-b border-slate-200">
        <nav className="-mb-px flex gap-6" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={[
                'border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
                tab === item.key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'claims' && (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(event) => setOpenOnly(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
                disabled={Boolean(status)}
              />
              Open only
            </label>
            <div className="w-52">
              <Select
                options={CLAIM_STATUS_OPTIONS}
                placeholder="Any status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                aria-label="Filter by status"
              />
            </div>
          </div>

          <Table>
            <THead columns={COLUMNS} />
            <TBody>
              {loading && <TRMessage colSpan={COLUMNS.length}>Loading claims…</TRMessage>}
              {!loading && claims.length === 0 && (
                <TRMessage colSpan={COLUMNS.length}>No claims match.</TRMessage>
              )}
              {!loading &&
                claims.map((claim) => {
                  const actions = claimActions(claim.status).filter((action) =>
                    action === 'decision' || action === 'settle' ? canDecide : canSubmit,
                  );
                  return (
                    <TR key={claim._id}>
                      <TD>
                        <span className="font-mono text-xs font-medium text-brand-600">
                          {claim.claimNumber}
                        </span>
                        <div className="text-xs text-slate-400">
                          {claim.encounterId?.encounterNumber}
                        </div>
                      </TD>
                      <TD>
                        <Link
                          to={`/patients/${claim.patientId?._id}`}
                          className="font-medium text-slate-900 hover:text-brand-700"
                        >
                          {fullName(claim.patientId)}
                        </Link>
                        <div className="text-xs text-slate-400">{claim.patientId?.mrn}</div>
                      </TD>
                      <TD>
                        <div className="text-sm">
                          {claim.providerId?.name}
                          {claim.providerId?.kind === 'tpa' && (
                            <Badge tone="purple" className="ml-2">TPA</Badge>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">{claim.policyId?.policyNumber}</div>
                      </TD>
                      <TD>
                        <div className="text-sm font-medium">{claim.claimedAmount}</div>
                        <div className="text-xs text-slate-400">
                          {claim.approvedAmount ? `approved ${claim.approvedAmount}` : '—'}
                          {claim.settledAmount ? ` · paid ${claim.settledAmount}` : ''}
                        </div>
                      </TD>
                      <TD>
                        {claim.submittedAt ? (
                          <span className="text-sm">{claim.ageDays}d</span>
                        ) : (
                          <span className="text-xs text-slate-400">not sent</span>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={CLAIM_STATUS_TONES[claim.status] ?? 'neutral'}>
                          {claim.status}
                        </Badge>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap justify-end gap-1">
                          {actions.map((action) => (
                            <Button
                              key={action}
                              size="sm"
                              variant={action === 'settle' ? 'primary' : 'secondary'}
                              loading={busyId === claim._id}
                              onClick={() =>
                                action === 'submit' || action === 'resubmit'
                                  ? submit(claim)
                                  : setModal({ action, claim })
                              }
                            >
                              {ACTION_LABELS[action]}
                            </Button>
                          ))}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
            </TBody>
          </Table>
        </>
      )}

      {tab === 'aging' && (
        loading ? (
          <Spinner label="Building the aging report…" className="py-10" />
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-4">
              {Object.entries(aging?.meta?.buckets ?? {}).map(([bucket, value]) => (
                <Card key={bucket} className="!p-3">
                  <p className="text-xs text-slate-500">{bucket} days</p>
                  <p className="text-xl font-semibold text-slate-900">{value.amount}</p>
                  <Badge tone={BUCKET_TONES[bucket] ?? 'neutral'}>{value.count} claim(s)</Badge>
                </Card>
              ))}
            </div>

            {aging?.meta?.totals?.overdueCount > 0 && (
              <Alert tone="warning" title="Overdue">
                {aging.meta.totals.overdueCount} claim(s) worth {aging.meta.totals.overdueAmount} are
                past the insurer&apos;s own settlement terms.
              </Alert>
            )}

            <div>
              <CardHeader
                title="By insurer"
                description={
                  aging?.meta?.totals
                    ? `${aging.meta.totals.count} outstanding, total ${aging.meta.totals.amount}`
                    : undefined
                }
              />
              <div className="space-y-2">
                {(aging?.meta?.byProvider ?? []).map((row) => (
                  <Card key={String(row.providerId)} className="!p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{row.provider}</p>
                        <p className="text-xs text-slate-500">
                          {row.count} claim(s){row.overdue > 0 ? ` · ${row.overdue} overdue` : ''}
                        </p>
                      </div>
                      <p className="font-semibold text-slate-900">{row.amount}</p>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )
      )}

      {tab === 'settlement' && (
        loading ? (
          <Spinner label="Building the settlement report…" className="py-10" />
        ) : (
          <div>
            <CardHeader
              title="Settled claims"
              description={
                settlement?.meta
                  ? `${settlement.meta.claims} claim(s) · claimed ${settlement.meta.claimed} · settled ${settlement.meta.settled}`
                  : undefined
              }
            />
            {(settlement?.data ?? []).length === 0 ? (
              <Card><p className="py-6 text-center text-sm text-slate-500">Nothing settled yet.</p></Card>
            ) : (
              <div className="space-y-2">
                {settlement.data.map((row) => (
                  <Card key={String(row.providerId)} className="!p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{row.provider}</p>
                        <p className="text-xs text-slate-500">
                          {row.claims} claim(s) · claimed {row.claimed} · rejected {row.rejected}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-slate-900">{row.settled}</p>
                        <Badge tone={row.settlementRate >= 90 ? 'success' : row.settlementRate >= 70 ? 'warning' : 'danger'}>
                          {row.settlementRate}% settled
                        </Badge>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )
      )}

      <ClaimDecisionModal
        action={modal.action}
        claim={modal.claim}
        onClose={() => setModal({ action: null, claim: null })}
        onDone={(response) => {
          setNotice(response.message);
          load();
        }}
      />
    </div>
  );
}

export default ClaimsPage;
