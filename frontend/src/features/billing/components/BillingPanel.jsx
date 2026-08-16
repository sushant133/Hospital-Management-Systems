import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  billingApi,
  INVOICE_STATUS_TONES,
} from '../../../api/billingApi.js';
import { packageApi } from '../../../api/packageApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, Input, Spinner,
  Table, TBody, TD, THead, TR,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'desc', label: 'Charge' },
  { key: 'source', label: 'From' },
  { key: 'qty', label: 'Qty' },
  { key: 'amount', label: 'Amount' },
  { key: 'tax', label: 'Tax' },
  { key: 'status', label: 'Status' },
];

/**
 * The money side of one visit: what has been charged, and the bill it is on.
 *
 * Charges accrue continuously while a patient is in, so an invoice raised on
 * Tuesday will not include Wednesday's lab result — hence *Pull in new
 * charges* rather than a second invoice.
 */
export function BillingPanel({ encounterId, canInvoice, canCharge: _canCharge }) {
  const { can } = useAuth();
  const canApplyPackage = can(MODULES.BILLING_PACKAGES, 'apply');
  const [lines, setLines] = useState([]);
  const [invoice, setInvoice] = useState(null);
  const [totals, setTotals] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  const [taxPercent, setTaxPercent] = useState('0');
  const [packages, setPackages] = useState([]);
  const [packageId, setPackageId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ledgerRes, invoiceRes] = await Promise.all([
        billingApi.listLineItems({ encounterId, limit: 200 }),
        billingApi.listInvoices({ encounterId, limit: 5 }),
      ]);
      setLines(ledgerRes.data);
      setTotals(ledgerRes.meta?.totals ?? null);
      setInvoice((invoiceRes.data ?? []).find((inv) => inv.status !== 'void') ?? null);
      if (canApplyPackage) {
        const pkgs = await packageApi.list({ limit: 50 }).catch(() => ({ data: [] }));
        setPackages(pkgs.data ?? []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [encounterId, canApplyPackage]);

  useEffect(() => {
    load();
  }, [load]);

  const raiseInvoice = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await billingApi.createInvoice({
        encounterId,
        taxPercent: Number(taxPercent || 0),
      });
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const pullCharges = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await billingApi.syncCharges(invoice._id);
      setNotice(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const applyPkg = async () => {
    if (!packageId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await packageApi.apply(packageId, { encounterId });
      setNotice(response.message);
      setPackageId('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const unbilled = lines.filter((line) => line.status === 'unbilled');

  if (loading) return <Spinner label="Loading charges…" className="py-8" />;

  return (
    <div className="space-y-4">
      {notice && (
        <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>
      )}
      {error && (
        <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>
      )}

      {invoice ? (
        <Card>
          <CardHeader
            title={`Invoice ${invoice.invoiceNumber}`}
            description={
              invoice.issuedAt
                ? `Issued ${formatDate(invoice.issuedAt)}`
                : 'Drafted — not yet issued to the patient'
            }
            action={<Badge tone={INVOICE_STATUS_TONES[invoice.status] ?? 'neutral'}>{invoice.status}</Badge>}
          />

          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Total</p>
              <p className="font-semibold text-slate-900">{invoice.total}</p>
              {invoice.taxAmount > 0 && (
                <p className="text-[11px] text-slate-400">incl. tax {invoice.taxAmount}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-slate-500">Insurer</p>
              <p>{invoice.insuranceCoveredAmount}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Received</p>
              <p>{invoice.amountPaid}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Balance</p>
              <p className={invoice.balance > 0 ? 'font-semibold text-red-700' : 'text-slate-900'}>
                {invoice.balance}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/billing">
              <Button variant="secondary" size="sm">Open in billing</Button>
            </Link>
            {canInvoice && unbilled.length > 0 && !['paid', 'void'].includes(invoice.status) && (
              <Button size="sm" loading={saving} onClick={pullCharges}>
                Pull in {unbilled.length} new charge(s)
              </Button>
            )}
            <a
              href={billingApi.receiptUrl(invoice._id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Receipt
            </a>
          </div>
        </Card>
      ) : (
        canInvoice && (
          <Card>
            <CardHeader
              title="No invoice yet"
              description={
                unbilled.length
                  ? `${unbilled.length} unbilled charge(s) ready to consolidate.`
                  : 'Nothing to bill on this visit yet.'
              }
            />
            {unbilled.length > 0 && (
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-32">
                  <Input
                    label="Tax %"
                    type="number"
                    min="0"
                    max="100"
                    value={taxPercent}
                    onChange={(event) => setTaxPercent(event.target.value)}
                  />
                </div>
                <Button loading={saving} onClick={raiseInvoice}>
                  Raise invoice
                </Button>
              </div>
            )}
          </Card>
        )
      )}

      {canApplyPackage && packages.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="form-label">Apply package</label>
            <select className="form-control" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              <option value="">Choose a package…</option>
              {packages.map((pkg) => (
                <option key={pkg._id} value={pkg._id}>
                  {pkg.code} — {pkg.name}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" loading={saving} disabled={!packageId} onClick={applyPkg}>
            Apply
          </Button>
        </div>
      )}

      <div>
        <CardHeader
          title="Charges"
          description={totals ? `${totals.all} charged on this visit` : undefined}
        />
        {lines.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="No charges"
            description="Charges appear here as lab orders, imaging, dispensing and bed nights are recorded."
          />
        ) : (
          <Table>
            <THead columns={COLUMNS} />
            <TBody>
              {lines.map((line) => (
                <TR key={line._id}>
                  <TD>
                    <div className="text-sm text-slate-900">{line.description}</div>
                    <div className="text-xs text-slate-400">{line.sourceRef}</div>
                  </TD>
                  <TD>
                    <Badge tone="neutral">{line.sourceType}</Badge>
                  </TD>
                  <TD>{line.quantity}</TD>
                  <TD>{line.lineTotal}</TD>
                  <TD>{line.taxAmount ? `${line.taxAmount} (${line.taxPercent}%)` : '—'}</TD>
                  <TD>
                    <Badge
                      tone={
                        line.status === 'invoiced'
                          ? 'info'
                          : line.status === 'cancelled'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {line.status}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  );
}

export default BillingPanel;
