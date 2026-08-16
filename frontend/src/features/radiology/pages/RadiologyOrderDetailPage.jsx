import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  radiologyApi,
  RAD_STATUS_TONES,
  PRIORITY_TONES,
  MODALITY_LABELS,
  nextAction,
} from '../../../api/radiologyApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName, ageFrom, titleCase } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, DataRow, Input, Modal, PageHeader,
  Spinner, Textarea,
} from '../../../components/ui/index.js';

export function RadiologyOrderDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();

  const canReport = can(MODULES.RADIOLOGY_RESULTS, 'create');
  const canVerify = can(MODULES.RADIOLOGY_RESULTS, 'verify');
  const canAmend = can(MODULES.RADIOLOGY_RESULTS, 'amend');
  const canAttach = can(MODULES.RADIOLOGY_RESULTS, 'attachImages');
  const canSchedule = can(MODULES.RADIOLOGY_ORDERS, 'schedule');
  const canStart = can(MODULES.RADIOLOGY_ORDERS, 'edit');
  const canCancel = can(MODULES.RADIOLOGY_ORDERS, 'cancel');

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [amendOpen, setAmendOpen] = useState(false);

  const [form, setForm] = useState({
    technique: '',
    findings: '',
    impression: '',
    recommendation: '',
    isCritical: false,
    criticalNote: '',
  });
  const [amendmentReason, setAmendmentReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await radiologyApi.getOrder(id);
      setOrder(data);
      if (data.result) {
        setForm({
          technique: data.result.technique ?? '',
          findings: data.result.findings ?? '',
          impression: data.result.impression ?? '',
          recommendation: data.result.recommendation ?? '',
          isCritical: Boolean(data.result.isCritical),
          criticalNote: data.result.criticalNote ?? '',
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (fn, successMessage) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fn();
      setNotice(successMessage ?? response?.message ?? 'Done');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveReport = (status) =>
    runAction(
      () => radiologyApi.submitResult(id, { ...form, status }),
      status === 'verified' ? 'Report verified' : 'Preliminary report saved',
    );

  const submitAmendment = () =>
    runAction(async () => {
      const response = await radiologyApi.amendResult(id, { ...form, amendmentReason });
      setAmendOpen(false);
      setAmendmentReason('');
      return response;
    }, 'Report amended');

  const handleFiles = async (event) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (!files.length) return;
    await runAction(() => radiologyApi.attachImages(id, files), 'Images attached');
  };

  if (loading) return <Spinner label="Loading imaging order…" className="py-20" />;

  if (error && !order) {
    return (
      <div>
        <Alert tone="error" title="Could not load order">{error}</Alert>
        <Link to="/radiology" className="mt-4 inline-block text-sm text-brand-600">
          ← Back to radiology
        </Link>
      </div>
    );
  }
  if (!order) return null;

  const patient = order.patientId ?? {};
  const result = order.result;
  const age = ageFrom(patient.dateOfBirth);
  const next = nextAction(order.status);
  const isClosed = ['completed', 'cancelled'].includes(order.status);
  const canWriteReport = canReport && !isClosed && order.status !== 'ordered';
  const isSignedOff = result && ['verified', 'amended'].includes(result.status);

  return (
    <div>
      <PageHeader
        breadcrumb={<Link to="/radiology" className="hover:text-slate-700">← Radiology</Link>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{order.orderNumber}</span>
            <Badge tone={RAD_STATUS_TONES[order.status] ?? 'neutral'}>{order.status}</Badge>
            <Badge tone={PRIORITY_TONES[order.priority] ?? 'neutral'}>
              {order.priority === 'stat' ? 'STAT' : order.priority}
            </Badge>
          </span>
        }
        description={`${fullName(patient)} · ${patient.mrn ?? '—'} · ${age !== null ? `${age} yrs` : '—'} ${titleCase(patient.gender)}`}
        action={
          <div className="flex flex-wrap gap-2">
            {order.reportPath && (
              <a href={radiologyApi.reportUrl(order._id)} target="_blank" rel="noreferrer">
                <Button variant="secondary">📄 View report</Button>
              </a>
            )}
            {canReport && order.status === 'completed' && (
              <Button
                variant="ghost"
                loading={busy}
                onClick={() =>
                  runAction(() => radiologyApi.regenerateReport(order._id), 'Report regenerated')
                }
              >
                Regenerate
              </Button>
            )}
            {canSchedule && next?.action === 'schedule' && (
              <Button onClick={() => setScheduleOpen(true)}>{next.label}</Button>
            )}
            {canStart && (next?.action === 'start' || order.status === 'ordered') && !isClosed && (
              <Button
                variant={next?.action === 'start' ? 'primary' : 'secondary'}
                loading={busy}
                onClick={() => runAction(() => radiologyApi.start(order._id), 'Study started')}
              >
                {order.status === 'ordered' ? 'Start without scheduling' : next.label}
              </Button>
            )}
            {canCancel && !isClosed && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Cancel order
              </Button>
            )}
          </div>
        }
      />

      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}

      {result?.isCritical && (
        <Alert tone="error" title="Critical finding" className="mb-4">
          {result.criticalNote || 'This study has a critical finding. Notify the requesting clinician immediately.'}
        </Alert>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Request" />
          <dl className="divide-y divide-slate-100">
            <DataRow label="Exam" value={`${order.name} (${order.code})`} />
            <DataRow label="Modality" value={MODALITY_LABELS[order.modality] ?? order.modality} />
            <DataRow label="Body part" value={order.bodyPart} />
            <DataRow label="Indication" value={order.clinicalIndication || '—'} />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Study" />
          <dl className="divide-y divide-slate-100">
            <DataRow label="Ordered by" value={fullName(order.orderedBy)} />
            <DataRow label="Ordered at" value={formatDate(order.createdAt, { withTime: true })} />
            <DataRow
              label="Scheduled"
              value={order.scheduledFor ? formatDate(order.scheduledFor, { withTime: true }) : 'Not scheduled'}
            />
            <DataRow
              label="Started"
              value={order.startedAt ? formatDate(order.startedAt, { withTime: true }) : '—'}
            />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Billing" description="Charged to the visit at order time" />
          <dl className="divide-y divide-slate-100">
            <DataRow label="Price" value={`${order.price}`} />
            <DataRow label="Contrast" value={order.contrastRequired ? 'Required' : 'Not required'} />
            <DataRow label="Visit" value={order.encounterId?.encounterNumber} />
            <DataRow
              label="Report"
              value={
                order.reportGeneratedAt
                  ? formatDate(order.reportGeneratedAt, { withTime: true })
                  : 'Not generated yet'
              }
            />
          </dl>
        </Card>
      </div>

      {order.status === 'cancelled' && (
        <Alert tone="warning" title="Order cancelled" className="mb-6">
          {order.cancellationReason || 'No reason recorded.'} Unbilled charges were reversed.
        </Alert>
      )}

      {order.status === 'ordered' && (
        <Alert tone="info" className="mb-6">
          Schedule the study, or start it immediately for STAT/walk-in cases, before reporting.
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader
          title="Report"
          description={
            result
              ? `${result.status}${result.verifiedAt ? ` · signed ${formatDate(result.verifiedAt, { withTime: true })}` : ''}`
              : 'Findings and impression'
          }
          action={
            isSignedOff && canAmend && (
              <Button size="sm" variant="secondary" onClick={() => setAmendOpen(true)}>
                Amend
              </Button>
            )
          }
        />

        {canWriteReport && !isSignedOff ? (
          <div className="space-y-4">
            <Input
              label="Technique"
              value={form.technique}
              onChange={(e) => setForm((p) => ({ ...p, technique: e.target.value }))}
              placeholder="PA and lateral views, no contrast"
            />
            <Textarea
              label="Findings"
              rows={5}
              value={form.findings}
              onChange={(e) => setForm((p) => ({ ...p, findings: e.target.value }))}
              required
            />
            <Textarea
              label="Impression"
              rows={3}
              value={form.impression}
              onChange={(e) => setForm((p) => ({ ...p, impression: e.target.value }))}
              required
            />
            <Textarea
              label="Recommendation"
              rows={2}
              value={form.recommendation}
              onChange={(e) => setForm((p) => ({ ...p, recommendation: e.target.value }))}
            />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isCritical}
                onChange={(e) => setForm((p) => ({ ...p, isCritical: e.target.checked }))}
              />
              Critical finding
            </label>
            {form.isCritical && (
              <Textarea
                label="Critical note"
                rows={2}
                value={form.criticalNote}
                onChange={(e) => setForm((p) => ({ ...p, criticalNote: e.target.value }))}
                placeholder="What needs immediate action?"
                required
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" loading={busy} onClick={() => saveReport('preliminary')}>
                Save draft
              </Button>
              {canVerify && (
                <Button loading={busy} onClick={() => saveReport('verified')}>
                  Verify and complete
                </Button>
              )}
            </div>
          </div>
        ) : result ? (
          <dl className="divide-y divide-slate-100">
            <DataRow label="Technique" value={result.technique || '—'} />
            <DataRow label="Findings" value={result.findings} />
            <DataRow label="Impression" value={result.impression} />
            <DataRow label="Recommendation" value={result.recommendation || '—'} />
            <DataRow label="Reported by" value={fullName(result.reportedBy)} />
            <DataRow label="Verified by" value={result.verifiedBy ? fullName(result.verifiedBy) : '—'} />
          </dl>
        ) : (
          <p className="py-4 text-sm text-slate-500">No report written yet.</p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Images"
          description="Stored on the server and downloaded only through this page"
          action={
            canAttach && result && (
              <label className="inline-flex cursor-pointer">
                <input
                  type="file"
                  className="sr-only"
                  multiple
                  accept="image/jpeg,image/png,image/webp,image/tiff,application/pdf"
                  onChange={handleFiles}
                />
                <span className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  + Attach files
                </span>
              </label>
            )
          }
        />
        {!result && (
          <p className="py-4 text-sm text-slate-500">Write the report first, then attach images.</p>
        )}
        {result && (result.attachments ?? []).length === 0 && (
          <p className="py-4 text-sm text-slate-500">No images attached.</p>
        )}
        {result && (result.attachments ?? []).length > 0 && (
          <ul className="divide-y divide-slate-100">
            {result.attachments.map((file) => (
              <li key={file._id} className="flex items-center justify-between gap-3 py-2">
                <a
                  href={radiologyApi.attachmentUrl(order._id, file._id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  {file.filename}
                </a>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>{Math.round((file.sizeBytes ?? 0) / 1024)} KB</span>
                  {canAttach && (
                    <button
                      type="button"
                      className="font-medium text-red-600 hover:text-red-700"
                      onClick={() =>
                        runAction(
                          () => radiologyApi.removeAttachment(order._id, file._id),
                          'Attachment removed',
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Schedule study"
        footer={
          <>
            <Button variant="secondary" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button
              loading={busy}
              onClick={() => {
                if (!scheduledFor) return setError('Pick a date and time');
                runAction(async () => {
                  const response = await radiologyApi.schedule(order._id, {
                    scheduledFor: new Date(scheduledFor).toISOString(),
                  });
                  setScheduleOpen(false);
                  return response;
                }, 'Study scheduled');
              }}
            >
              Schedule
            </Button>
          </>
        }
      >
        <Input
          label="Date and time"
          type="datetime-local"
          value={scheduledFor}
          onChange={(e) => setScheduledFor(e.target.value)}
          required
        />
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this order?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>Keep</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() =>
                runAction(async () => {
                  const response = await radiologyApi.cancel(order._id, { reason: cancelReason });
                  setCancelOpen(false);
                  return response;
                }, 'Order cancelled')
              }
            >
              Cancel order
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason"
          rows={3}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
        />
      </Modal>

      <Modal
        open={amendOpen}
        onClose={() => setAmendOpen(false)}
        title="Amend verified report"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAmendOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={submitAmendment} disabled={amendmentReason.trim().length < 5}>
              Save amendment
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Textarea
            label="Findings"
            rows={4}
            value={form.findings}
            onChange={(e) => setForm((p) => ({ ...p, findings: e.target.value }))}
          />
          <Textarea
            label="Impression"
            rows={3}
            value={form.impression}
            onChange={(e) => setForm((p) => ({ ...p, impression: e.target.value }))}
          />
          <Textarea
            label="Reason for amendment"
            rows={2}
            value={amendmentReason}
            onChange={(e) => setAmendmentReason(e.target.value)}
            required
          />
        </div>
      </Modal>
    </div>
  );
}

export default RadiologyOrderDetailPage;
