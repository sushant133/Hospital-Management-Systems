import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  patientsApi,
  GENDER_OPTIONS,
  BLOOD_GROUP_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  PATIENT_STATUS_OPTIONS,
} from '../../../api/patientApi.js';
import DuplicateWarning from '../components/DuplicateWarning.jsx';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { toDateInput } from '../../../utils/format.js';
import {
  Alert, Button, Card, CardHeader, Input, PageHeader, Select, Spinner,
} from '../../../components/ui/index.js';

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: '',
  bloodGroup: 'unknown',
  maritalStatus: 'unknown',
  phone: '',
  email: '',
  nationalId: '',
  status: 'active',
  address: { line1: '', line2: '', city: '', state: '', postalCode: '', country: '' },
  emergencyContact: { name: '', relationship: '', phone: '' },
  insurance: { provider: '', policyNumber: '', validTill: '' },
};

/** Enough identifying data to make an MPI lookup worth running. */
function isCheckable(form) {
  if (form.nationalId.trim().length >= 4) return true;
  if (form.phone.trim().length >= 6) return true;
  return Boolean(form.lastName.trim() && form.dateOfBirth);
}

export function PatientFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const { can } = useAuth();

  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);

  // --- MPI duplicate detection ---
  const [duplicates, setDuplicates] = useState([]);
  const [duplicatesBlocking, setDuplicatesBlocking] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const canOverride = can(MODULES.PATIENTS, 'overrideDuplicate');

  useEffect(() => {
    if (!isEdit) return;

    let cancelled = false;
    (async () => {
      try {
        const { data } = await patientsApi.get(id);
        if (cancelled) return;
        setForm({
          ...EMPTY_FORM,
          ...data,
          dateOfBirth: toDateInput(data.dateOfBirth),
          email: data.email ?? '',
          address: { ...EMPTY_FORM.address, ...(data.address ?? {}) },
          emergencyContact: { ...EMPTY_FORM.emergencyContact, ...(data.emergencyContact ?? {}) },
          insurance: {
            ...EMPTY_FORM.insurance,
            ...(data.insurance ?? {}),
            validTill: toDateInput(data.insurance?.validTill),
          },
        });
      } catch (error) {
        if (!cancelled) setFormError(error.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, isEdit]);

  /**
   * Live duplicate check while the form is filled in, debounced so typing a
   * surname doesn't fire a request per keystroke. Runs on edit too — correcting
   * a phone number can reveal that this record duplicates another.
   */
  useEffect(() => {
    if (!isCheckable(form)) {
      setDuplicates([]);
      setDuplicatesBlocking(false);
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { data } = await patientsApi.checkDuplicates(
          {
            firstName: form.firstName.trim() || undefined,
            lastName: form.lastName.trim() || undefined,
            dateOfBirth: form.dateOfBirth || undefined,
            gender: form.gender || undefined,
            phone: form.phone.trim() || undefined,
            email: form.email.trim() || undefined,
            nationalId: form.nationalId.trim() || undefined,
            excludeId: id || undefined,
          },
          { signal: controller.signal },
        );
        setDuplicates(data.matches);
        setDuplicatesBlocking(data.blocking);
        if (!data.blocking) {
          setAcknowledged(false);
          setOverrideReason('');
        }
      } catch {
        // A failed pre-check must not block registration — the server runs the
        // same check authoritatively on submit.
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    form.firstName,
    form.lastName,
    form.dateOfBirth,
    form.gender,
    form.phone,
    form.email,
    form.nationalId,
    id,
  ]);

  const setField = (path) => (event) => {
    const { value } = event.target;
    setFieldErrors((prev) => ({ ...prev, [path]: undefined }));

    setForm((prev) => {
      const [section, key] = path.split('.');
      if (key) return { ...prev, [section]: { ...prev[section], [key]: value } };
      return { ...prev, [path]: value };
    });
  };

  /** Strip empty strings so optional fields aren't sent as ''. */
  const cleanPayload = () => {
    const prune = (obj) =>
      Object.fromEntries(
        Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined),
      );

    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      dateOfBirth: form.dateOfBirth,
      gender: form.gender,
      bloodGroup: form.bloodGroup,
      maritalStatus: form.maritalStatus,
      phone: form.phone.trim(),
      status: form.status,
    };
    if (form.email.trim()) payload.email = form.email.trim();
    if (form.nationalId.trim()) payload.nationalId = form.nationalId.trim();

    const address = prune(form.address);
    if (Object.keys(address).length) payload.address = address;

    const emergencyContact = prune(form.emergencyContact);
    if (Object.keys(emergencyContact).length) payload.emergencyContact = emergencyContact;

    const insurance = prune(form.insurance);
    if (Object.keys(insurance).length) payload.insurance = insurance;

    return payload;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      const payload = cleanPayload();

      if (!isEdit && acknowledged) {
        payload.acknowledgeDuplicates = true;
        payload.duplicateOverrideReason = overrideReason.trim();
      }

      const response = isEdit
        ? await patientsApi.update(id, payload)
        : await patientsApi.create(payload);
      navigate(`/patients/${response.data._id}`, { replace: true });
    } catch (error) {
      // The server runs the MPI check authoritatively; if it refuses, show the
      // matches it found rather than the raw error.
      if (error.code === 'POSSIBLE_DUPLICATE_PATIENT') {
        setDuplicates(error.details?.matches ?? []);
        setDuplicatesBlocking(true);
        setFormError('This person may already be registered — review the matches below.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const errors = error.fieldErrors ?? {};
      setFieldErrors(errors);
      setFormError(
        Object.keys(errors).length
          ? 'Please correct the highlighted fields.'
          : error.message || 'Could not save the patient record.',
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner label="Loading patient…" className="py-20" />;

  /**
   * A confident duplicate stops registration until it is consciously overridden
   * with a reason. Editing an existing record is never blocked — the warning is
   * informational there, since no new chart is being created.
   */
  const submitBlocked =
    !isEdit &&
    duplicatesBlocking &&
    (!canOverride || !acknowledged || overrideReason.trim().length < 10);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={isEdit ? 'Edit patient' : 'Register patient'}
        description={
          isEdit
            ? 'Update demographic and contact details.'
            : 'A medical record number (MRN) is assigned automatically.'
        }
        breadcrumb={
          <button type="button" onClick={() => navigate(-1)} className="hover:text-slate-700">
            ← Back
          </button>
        }
      />

      {formError && (
        <Alert tone="error" title="Could not save" className="mb-4">
          {formError}
        </Alert>
      )}

      <DuplicateWarning
        matches={duplicates}
        blocking={duplicatesBlocking && !isEdit}
        acknowledged={acknowledged}
        onAcknowledgeChange={setAcknowledged}
        reason={overrideReason}
        onReasonChange={setOverrideReason}
        canOverride={canOverride}
      />

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <Card>
          <CardHeader title="Identity" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="First name" value={form.firstName} onChange={setField('firstName')} error={fieldErrors.firstName} required />
            <Input label="Last name" value={form.lastName} onChange={setField('lastName')} error={fieldErrors.lastName} required />
            <Input label="Date of birth" type="date" max={new Date().toISOString().slice(0, 10)} value={form.dateOfBirth} onChange={setField('dateOfBirth')} error={fieldErrors.dateOfBirth} required />
            <Select label="Gender" options={GENDER_OPTIONS} placeholder="Select gender" value={form.gender} onChange={setField('gender')} error={fieldErrors.gender} required />
            <Select label="Blood group" options={BLOOD_GROUP_OPTIONS} value={form.bloodGroup} onChange={setField('bloodGroup')} error={fieldErrors.bloodGroup} />
            <Select label="Marital status" options={MARITAL_STATUS_OPTIONS} value={form.maritalStatus} onChange={setField('maritalStatus')} error={fieldErrors.maritalStatus} />
            {isEdit && (
              <Select label="Record status" options={PATIENT_STATUS_OPTIONS} value={form.status} onChange={setField('status')} error={fieldErrors.status} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Contact" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Phone" value={form.phone} onChange={setField('phone')} error={fieldErrors.phone} placeholder="+1 555 010 0000" required />
            <Input label="Email" type="email" value={form.email} onChange={setField('email')} error={fieldErrors.email} />
            <Input
              label="National ID"
              className="sm:col-span-2"
              value={form.nationalId}
              onChange={setField('nationalId')}
              error={fieldErrors.nationalId}
              hint="Optional, but the strongest signal for spotting a duplicate registration."
            />
            <Input label="Address line 1" className="sm:col-span-2" value={form.address.line1} onChange={setField('address.line1')} error={fieldErrors['address.line1']} />
            <Input label="Address line 2" className="sm:col-span-2" value={form.address.line2} onChange={setField('address.line2')} error={fieldErrors['address.line2']} />
            <Input label="City" value={form.address.city} onChange={setField('address.city')} error={fieldErrors['address.city']} />
            <Input label="State / Province" value={form.address.state} onChange={setField('address.state')} error={fieldErrors['address.state']} />
            <Input label="Postal code" value={form.address.postalCode} onChange={setField('address.postalCode')} error={fieldErrors['address.postalCode']} />
            <Input label="Country" value={form.address.country} onChange={setField('address.country')} error={fieldErrors['address.country']} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Emergency contact" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Name" value={form.emergencyContact.name} onChange={setField('emergencyContact.name')} error={fieldErrors['emergencyContact.name']} />
            <Input label="Relationship" value={form.emergencyContact.relationship} onChange={setField('emergencyContact.relationship')} error={fieldErrors['emergencyContact.relationship']} />
            <Input label="Phone" value={form.emergencyContact.phone} onChange={setField('emergencyContact.phone')} error={fieldErrors['emergencyContact.phone']} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Insurance" description="Optional" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Provider" value={form.insurance.provider} onChange={setField('insurance.provider')} error={fieldErrors['insurance.provider']} />
            <Input label="Policy number" value={form.insurance.policyNumber} onChange={setField('insurance.policyNumber')} error={fieldErrors['insurance.policyNumber']} />
            <Input label="Valid until" type="date" value={form.insurance.validTill} onChange={setField('insurance.validTill')} error={fieldErrors['insurance.validTill']} />
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting} disabled={submitBlocked}>
            {isEdit ? 'Save changes' : 'Register patient'}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default PatientFormPage;
