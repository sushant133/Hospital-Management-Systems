import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  insuranceApi,
  POLICY_STATUS_OPTIONS,
  POLICY_STATUS_TONES,
  RELATIONSHIP_OPTIONS,
} from '../../../api/insuranceApi.js';
import { patientsApi } from '../../../api/patientApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName, toDateInput } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, Input, Modal, PageHeader, Select, Spinner,
  Table, TBody, TD, THead, TR, TRMessage, Textarea,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'patient', label: 'Patient' },
  { key: 'insurer', label: 'Insurer / policy' },
  { key: 'cover', label: 'Cover' },
  { key: 'valid', label: 'Valid' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '' },
];

const EMPTY_POLICY = {
  patientId: '', providerId: '', policyNumber: '', planName: '',
  memberName: '', relationshipToMember: 'self', coPayPercent: '',
  coverageLimit: '', validFrom: '', validTill: '',
};

/**
 * Linking patients to cover, and confirming that cover is live.
 *
 * Eligibility is checked on demand rather than assumed: the desk needs to know
 * *why* a policy will not pay — lapsed, suspended, or limit exhausted are three
 * different conversations with the patient.
 */
export function PolicyLinkPage() {
  const { can } = useAuth();
  const canCreate = can(MODULES.PATIENT_POLICIES, 'create');
  const canVerify = can(MODULES.PATIENT_POLICIES, 'verifyEligibility');

  const [policies, setPolicies] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_POLICY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState([]);
  const [chosenPatient, setChosenPatient] = useState(null);

  const [eligibility, setEligibility] = useState(null);
  const [checking, setChecking] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [policyRes, providerRes] = await Promise.all([
        insuranceApi.listPolicies({ limit: 100 }),
        insuranceApi.listProviders({ limit: 100 }),
      ]);
      setPolicies(policyRes.data);
      setProviders(providerRes.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const term = patientSearch.trim();
    if (term.length < 2) {
      setPatientResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await patientsApi.list({ search: term, limit: 8 });
        setPatientResults(response.data);
      } catch {
        // The form still works without the lookup.
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [patientSearch]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const save = async () => {
    setFormError(null);

    if (!chosenPatient) return setFormError('Choose a patient.');
    if (!form.providerId) return setFormError('Choose an insurer.');
    if (!form.validFrom || !form.validTill) return setFormError('Give the cover dates.');

    setSaving(true);
    try {
      const response = await insuranceApi.createPolicy({
        patientId: chosenPatient._id,
        providerId: form.providerId,
        policyNumber: form.policyNumber.trim(),
        planName: form.planName.trim() || undefined,
        memberName: form.memberName.trim() || undefined,
        relationshipToMember: form.relationshipToMember,
        // Blank means "use the insurer's default", which the server stores as null.
        coPayPercent: form.coPayPercent === '' ? null : Number(form.coPayPercent),
        coverageLimit: Number(form.coverageLimit || 0),
        validFrom: form.validFrom,
        validTill: form.validTill,
      });
      setNotice(response.message);
      setModalOpen(false);
      setForm(EMPTY_POLICY);
      setChosenPatient(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const checkEligibility = async (policy) => {
    setChecking(policy._id);
    setError(null);
    try {
      const response = await insuranceApi.eligibility(policy._id);
      setEligibility({ policy, ...response });
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(null);
    }
  };

  const confirmVerified = async (policy) => {
    try {
      const response = await insuranceApi.verifyPolicy(policy._id, {
        notes: 'Confirmed from the policy list',
      });
      setNotice(response.message);
      setEligibility(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Insurance policies"
        description="Which patients hold cover, with whom, and whether it is live."
        action={
          canCreate && (
            <Button onClick={() => { setForm(EMPTY_POLICY); setChosenPatient(null); setFormError(null); setModalOpen(true); }}>
              Link a policy
            </Button>
          )
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

      <Table>
        <THead columns={COLUMNS} />
        <TBody>
          {loading && <TRMessage colSpan={COLUMNS.length}>Loading policies…</TRMessage>}
          {!loading && policies.length === 0 && (
            <TRMessage colSpan={COLUMNS.length}>
              No policies recorded. Link one to start claiming.
            </TRMessage>
          )}
          {!loading &&
            policies.map((policy) => (
              <TR key={policy._id}>
                <TD>
                  <Link
                    to={`/patients/${policy.patientId?._id}`}
                    className="font-medium text-slate-900 hover:text-brand-700"
                  >
                    {fullName(policy.patientId)}
                  </Link>
                  <div className="text-xs text-slate-400">{policy.patientId?.mrn}</div>
                </TD>
                <TD>
                  <div className="text-sm font-medium text-slate-900">
                    {policy.providerId?.name}
                    {policy.providerId?.kind === 'tpa' && (
                      <Badge tone="purple" className="ml-2">TPA</Badge>
                    )}
                  </div>
                  <div className="font-mono text-xs text-slate-400">{policy.policyNumber}</div>
                </TD>
                <TD>
                  <div className="text-sm">
                    {policy.coPayPercent ?? policy.providerId?.defaultCoPayPercent ?? 0}% co-pay
                  </div>
                  <div className="text-xs text-slate-400">
                    {policy.coverageLimit
                      ? `${policy.coverageUsed ?? 0} / ${policy.coverageLimit} used`
                      : 'No annual limit'}
                  </div>
                </TD>
                <TD>
                  <div className="whitespace-nowrap text-xs">
                    {formatDate(policy.validFrom)} → {formatDate(policy.validTill)}
                  </div>
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={POLICY_STATUS_TONES[policy.status] ?? 'neutral'}>
                      {policy.status}
                    </Badge>
                    {policy.verifiedAt ? (
                      <Badge tone="success">verified</Badge>
                    ) : (
                      <Badge tone="warning">unverified</Badge>
                    )}
                  </div>
                </TD>
                <TD>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={checking === policy._id}
                      onClick={() => checkEligibility(policy)}
                    >
                      Check cover
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
        </TBody>
      </Table>

      {/* --- Eligibility result --- */}
      <Modal
        open={Boolean(eligibility)}
        onClose={() => setEligibility(null)}
        title="Eligibility"
        description={
          eligibility
            ? `${eligibility.meta?.provider ?? ''} · ${eligibility.meta?.policyNumber ?? ''}`
            : ''
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setEligibility(null)}>Close</Button>
            {canVerify && eligibility?.data?.eligible && (
              <Button onClick={() => confirmVerified(eligibility.policy)}>
                Record as verified
              </Button>
            )}
          </>
        }
      >
        {eligibility && (
          <div className="space-y-3">
            <Alert tone={eligibility.data.eligible ? 'success' : 'error'}>
              {eligibility.data.eligible
                ? 'This policy is live and can be claimed against.'
                : 'This policy cannot currently be claimed against.'}
            </Alert>

            {eligibility.data.reasons?.length > 0 && (
              <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
                {eligibility.data.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500">Patient co-pay</p>
                <p className="font-semibold text-slate-900">{eligibility.data.coPayPercent}%</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Cover remaining</p>
                <p className="font-semibold text-slate-900">
                  {eligibility.data.coverageRemaining === null ||
                  eligibility.data.coverageRemaining === Infinity ||
                  eligibility.data.coverageRemaining === 'Infinity'
                    ? 'Unlimited'
                    : eligibility.data.coverageRemaining}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              {eligibility.data.verified
                ? `Last verified ${formatDate(eligibility.data.verifiedAt, { withTime: true })}`
                : 'Nobody has confirmed this policy with the insurer yet.'}
            </p>
          </div>
        )}
      </Modal>

      {/* --- Link a policy --- */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Link a policy to a patient"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={save}>Link policy</Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError && <Alert tone="error">{formError}</Alert>}

          <div>
            <label className="form-label" htmlFor="policy-patient">Patient</label>
            {chosenPatient ? (
              <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 p-2">
                <span className="text-sm">
                  {fullName(chosenPatient)} · {chosenPatient.mrn}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setChosenPatient(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <input
                  id="policy-patient"
                  type="search"
                  className="form-control"
                  placeholder="Search by name, MRN or phone…"
                  value={patientSearch}
                  onChange={(event) => setPatientSearch(event.target.value)}
                />
                <div className="mt-1 space-y-1">
                  {patientResults.map((result) => (
                    <button
                      key={result._id}
                      type="button"
                      className="w-full rounded-lg p-2 text-left text-sm hover:bg-slate-50"
                      onClick={() => { setChosenPatient(result); setPatientResults([]); setPatientSearch(''); }}
                    >
                      {fullName(result)} · {result.mrn}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Insurer"
              required
              placeholder="Select an insurer"
              value={form.providerId}
              onChange={set('providerId')}
              options={providers.map((p) => ({ value: p._id, label: `${p.name} (${p.defaultCoPayPercent}% default)` }))}
            />
            <Input label="Policy number" required value={form.policyNumber} onChange={set('policyNumber')} />
            <Input label="Plan name" value={form.planName} onChange={set('planName')} placeholder="Gold" />
            <Select
              label="Relationship to member"
              options={RELATIONSHIP_OPTIONS}
              value={form.relationshipToMember}
              onChange={set('relationshipToMember')}
            />
            {form.relationshipToMember !== 'self' && (
              <Input label="Principal member" value={form.memberName} onChange={set('memberName')} />
            )}
            <Input
              label="Co-pay %"
              type="number"
              min="0"
              max="100"
              value={form.coPayPercent}
              onChange={set('coPayPercent')}
              hint="Leave blank to use the insurer's default"
            />
            <Input
              label="Annual limit"
              type="number"
              min="0"
              value={form.coverageLimit}
              onChange={set('coverageLimit')}
              hint="0 for unlimited"
            />
            <div>
              <label className="form-label" htmlFor="valid-from">Valid from</label>
              <input id="valid-from" type="date" className="form-control" value={form.validFrom} onChange={set('validFrom')} />
            </div>
            <div>
              <label className="form-label" htmlFor="valid-till">Valid until</label>
              <input id="valid-till" type="date" className="form-control" min={form.validFrom || toDateInput(new Date())} value={form.validTill} onChange={set('validTill')} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default PolicyLinkPage;
