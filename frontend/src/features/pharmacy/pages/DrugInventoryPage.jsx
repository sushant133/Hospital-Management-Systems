import { useCallback, useEffect, useState } from 'react';
import {
  pharmacyApi,
  DRUG_FORM_OPTIONS,
  ROUTE_OPTIONS,
  ADJUST_ACTIONS,
  expiryTone,
} from '../../../api/pharmacyApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, toDateInput } from '../../../utils/format.js';
import BatchExpiryTable from '../components/BatchExpiryTable.jsx';
import {
  Alert, Badge, Button, Card, CardHeader, Input, Modal, PageHeader, Select, Spinner,
  Table, TBody, TD, THead, TR, TRMessage, Textarea,
} from '../../../components/ui/index.js';

const DRUG_COLUMNS = [
  { key: 'drug', label: 'Drug' },
  { key: 'form', label: 'Form' },
  { key: 'stock', label: 'In stock' },
  { key: 'price', label: 'Price' },
  { key: 'flags', label: '' },
  { key: 'actions', label: '' },
];

const TABS = [
  { key: 'formulary', label: 'Formulary' },
  { key: 'stock', label: 'Stock batches' },
  { key: 'alerts', label: 'Alerts' },
];

const EMPTY_DRUG = {
  drugCode: '', name: '', genericName: '', form: 'tablet', strength: '', unit: '',
  defaultRoute: 'oral', sellingPrice: '', reorderLevel: '', isControlled: false,
  allergenClasses: '', manufacturer: '', cautions: '',
};

const EMPTY_BATCH = {
  drugId: '', batchNo: '', expiryDate: '', quantityReceived: '', costPrice: '', supplier: '',
};

/**
 * The pharmacy's own view: what may be prescribed, what is on the shelf, and
 * what is about to be lost.
 */
export function DrugInventoryPage() {
  const { can } = useAuth();
  const canEditFormulary = can(MODULES.DRUGS, 'create');
  const canReceive = can(MODULES.DRUG_BATCHES, 'create');
  const canAdjust = can(MODULES.DRUG_BATCHES, 'adjust');

  const [tab, setTab] = useState('formulary');
  const [search, setSearch] = useState('');
  const [drugs, setDrugs] = useState([]);
  const [batches, setBatches] = useState([]);
  const [alerts, setAlerts] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [drugModal, setDrugModal] = useState(false);
  const [drugForm, setDrugForm] = useState(EMPTY_DRUG);
  const [batchModal, setBatchModal] = useState(false);
  const [batchForm, setBatchForm] = useState(EMPTY_BATCH);
  const [adjusting, setAdjusting] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ action: 'write-off', quantity: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'formulary') {
        const response = await pharmacyApi.listDrugs({ search: search || undefined, limit: 100 });
        setDrugs(response.data);
      } else if (tab === 'stock') {
        const response = await pharmacyApi.listBatches({ limit: 200 });
        setBatches(response.data);
      } else {
        const response = await pharmacyApi.alerts({ days: 90 });
        setAlerts(response);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => {
    load();
  }, [load]);

  const saveDrug = async () => {
    setFormError(null);
    setSaving(true);
    try {
      const response = await pharmacyApi.createDrug({
        ...drugForm,
        sellingPrice: Number(drugForm.sellingPrice || 0),
        reorderLevel: Number(drugForm.reorderLevel || 0),
        allergenClasses: drugForm.allergenClasses
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      });
      setNotice(response.message);
      setDrugModal(false);
      setDrugForm(EMPTY_DRUG);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveBatch = async () => {
    setFormError(null);
    setSaving(true);
    try {
      const response = await pharmacyApi.receiveBatch({
        ...batchForm,
        quantityReceived: Number(batchForm.quantityReceived || 0),
        costPrice: Number(batchForm.costPrice || 0),
      });
      setNotice(response.message);
      setBatchModal(false);
      setBatchForm(EMPTY_BATCH);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveAdjustment = async () => {
    setFormError(null);
    setSaving(true);
    try {
      const response = await pharmacyApi.adjustBatch(adjusting._id, {
        action: adjustForm.action,
        quantity: adjustForm.action === 'write-off' ? Number(adjustForm.quantity || 0) : undefined,
        reason: adjustForm.reason,
      });
      setNotice(response.message);
      setAdjusting(null);
      setAdjustForm({ action: 'write-off', quantity: '', reason: '' });
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const set = (key) => (event) =>
    setDrugForm((prev) => ({
      ...prev,
      [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
    }));
  const setBatch = (key) => (event) =>
    setBatchForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <div>
      <PageHeader
        title="Pharmacy inventory"
        description="The formulary, the stock behind it, and what is expiring."
        action={
          <div className="flex gap-2">
            {canReceive && (
              <Button variant="secondary" onClick={() => { setBatchForm(EMPTY_BATCH); setFormError(null); setBatchModal(true); }}>
                Receive stock
              </Button>
            )}
            {canEditFormulary && (
              <Button onClick={() => { setDrugForm(EMPTY_DRUG); setFormError(null); setDrugModal(true); }}>
                Add drug
              </Button>
            )}
          </div>
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

      {tab === 'formulary' && (
        <>
          <input
            type="search"
            className="form-control mb-4 max-w-sm"
            placeholder="Search by name, generic or code…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <Table>
            <THead columns={DRUG_COLUMNS} />
            <TBody>
              {loading && <TRMessage colSpan={DRUG_COLUMNS.length}>Loading formulary…</TRMessage>}
              {!loading && drugs.length === 0 && (
                <TRMessage colSpan={DRUG_COLUMNS.length}>No drugs match.</TRMessage>
              )}
              {!loading &&
                drugs.map((drug) => {
                  const low = drug.reorderLevel > 0 && drug.quantityOnHand <= drug.reorderLevel;
                  return (
                    <TR key={drug._id}>
                      <TD>
                        <div className="font-medium text-slate-900">{drug.name}</div>
                        <div className="text-xs text-slate-400">
                          {drug.genericName} · {drug.drugCode}
                        </div>
                      </TD>
                      <TD>
                        <span className="text-sm">{drug.strength} {drug.form}</span>
                      </TD>
                      <TD>
                        <span className={low ? 'font-semibold text-amber-700' : ''}>
                          {drug.quantityOnHand}
                        </span>
                        <span className="text-xs text-slate-400"> {drug.unit}</span>
                      </TD>
                      <TD>{drug.sellingPrice}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {low && <Badge tone="warning">reorder</Badge>}
                          {drug.isControlled && <Badge tone="danger">controlled</Badge>}
                          {drug.allergenClasses?.length > 0 && (
                            <Badge tone="info">{drug.allergenClasses.join(', ')}</Badge>
                          )}
                        </div>
                      </TD>
                      <TD />
                    </TR>
                  );
                })}
            </TBody>
          </Table>
        </>
      )}

      {tab === 'stock' && (
        <BatchExpiryTable
          batches={batches}
          loading={loading}
          canAdjust={canAdjust}
          onAdjust={(batch) => {
            setAdjusting(batch);
            setAdjustForm({ action: 'write-off', quantity: '', reason: '' });
            setFormError(null);
          }}
        />
      )}

      {tab === 'alerts' && (
        loading ? (
          <Spinner label="Checking stock…" className="py-10" />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <CardHeader
                title="Expiring stock"
                description={
                  alerts?.meta
                    ? `${alerts.meta.expiringCount} batch(es) within ${alerts.meta.withinDays} days · value at risk ${alerts.meta.valueAtRisk}`
                    : undefined
                }
              />
              {(alerts?.data?.expiring ?? []).length === 0 ? (
                <Card><p className="py-4 text-center text-sm text-slate-500">Nothing expiring soon.</p></Card>
              ) : (
                <div className="space-y-2">
                  {alerts.data.expiring.map((batch) => (
                    <Card key={batch._id} className="!p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-slate-900">{batch.drugId?.name}</p>
                          <p className="text-xs text-slate-500">
                            Batch {batch.batchNo} · {batch.quantityOnHand} {batch.drugId?.unit}
                          </p>
                        </div>
                        <Badge tone={expiryTone(batch.expiryDate)}>
                          {formatDate(batch.expiryDate)}
                        </Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <div>
              <CardHeader
                title="Low stock"
                description={alerts?.meta ? `${alerts.meta.lowStockCount} at or below reorder level` : undefined}
              />
              {(alerts?.data?.lowStock ?? []).length === 0 ? (
                <Card><p className="py-4 text-center text-sm text-slate-500">Everything is above its reorder level.</p></Card>
              ) : (
                <div className="space-y-2">
                  {alerts.data.lowStock.map((drug) => (
                    <Card key={drug._id} className="!p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-slate-900">{drug.name}</p>
                          <p className="text-xs text-slate-500">
                            {drug.quantityOnHand} in stock · reorder at {drug.reorderLevel}
                          </p>
                        </div>
                        <Badge tone={drug.quantityOnHand === 0 ? 'danger' : 'warning'}>
                          {drug.quantityOnHand === 0 ? 'out of stock' : `short ${drug.shortBy}`}
                        </Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      )}

      {/* --- Add drug --- */}
      <Modal
        open={drugModal}
        onClose={() => setDrugModal(false)}
        title="Add a drug to the formulary"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrugModal(false)}>Cancel</Button>
            <Button loading={saving} onClick={saveDrug}>Add drug</Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError && <Alert tone="error">{formError}</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Drug code" required value={drugForm.drugCode} onChange={set('drugCode')} placeholder="AMOX-500" />
            <Input label="Brand name" required value={drugForm.name} onChange={set('name')} placeholder="Amoxil" />
            <Input label="Generic name" required value={drugForm.genericName} onChange={set('genericName')} placeholder="Amoxicillin" />
            <Select label="Form" options={DRUG_FORM_OPTIONS} value={drugForm.form} onChange={set('form')} />
            <Input label="Strength" required value={drugForm.strength} onChange={set('strength')} placeholder="500 mg" />
            <Input label="Stock unit" required value={drugForm.unit} onChange={set('unit')} placeholder="capsule" />
            <Select label="Default route" options={ROUTE_OPTIONS} value={drugForm.defaultRoute} onChange={set('defaultRoute')} />
            <Input label="Selling price" type="number" step="0.01" required value={drugForm.sellingPrice} onChange={set('sellingPrice')} />
            <Input label="Reorder level" type="number" value={drugForm.reorderLevel} onChange={set('reorderLevel')} />
            <Input label="Manufacturer" value={drugForm.manufacturer} onChange={set('manufacturer')} />
          </div>

          <Input
            label="Allergen classes"
            hint="Comma-separated, e.g. penicillin, beta-lactam. This is what the allergy check matches — the drug name alone will not catch amoxicillin for a penicillin allergy."
            value={drugForm.allergenClasses}
            onChange={set('allergenClasses')}
            placeholder="penicillin, beta-lactam"
          />

          <Textarea label="Cautions" rows={2} value={drugForm.cautions} onChange={set('cautions')} />

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={drugForm.isControlled} onChange={set('isControlled')} />
            Controlled drug
          </label>
        </div>
      </Modal>

      {/* --- Receive stock --- */}
      <Modal
        open={batchModal}
        onClose={() => setBatchModal(false)}
        title="Receive stock"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBatchModal(false)}>Cancel</Button>
            <Button loading={saving} onClick={saveBatch}>Receive</Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError && <Alert tone="error">{formError}</Alert>}
          <Select
            label="Drug"
            required
            placeholder="Select a drug"
            value={batchForm.drugId}
            onChange={setBatch('drugId')}
            options={drugs.map((drug) => ({ value: drug._id, label: `${drug.name} ${drug.strength}` }))}
          />
          <Input label="Batch number" required value={batchForm.batchNo} onChange={setBatch('batchNo')} />
          <div>
            <label className="form-label" htmlFor="batch-expiry">Expiry date</label>
            <input
              id="batch-expiry"
              type="date"
              className="form-control"
              min={toDateInput(new Date())}
              value={batchForm.expiryDate}
              onChange={setBatch('expiryDate')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Quantity" type="number" required value={batchForm.quantityReceived} onChange={setBatch('quantityReceived')} />
            <Input label="Cost price" type="number" step="0.01" value={batchForm.costPrice} onChange={setBatch('costPrice')} />
          </div>
          <Input label="Supplier" value={batchForm.supplier} onChange={setBatch('supplier')} />
        </div>
      </Modal>

      {/* --- Adjust a batch --- */}
      <Modal
        open={Boolean(adjusting)}
        onClose={() => setAdjusting(null)}
        title="Adjust stock"
        description={adjusting ? `${adjusting.drugId?.name} · batch ${adjusting.batchNo}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdjusting(null)}>Cancel</Button>
            <Button variant="danger" loading={saving} onClick={saveAdjustment}>Record adjustment</Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError && <Alert tone="error">{formError}</Alert>}
          <Alert tone="warning">
            Adjustments change what the hospital believes it holds. The reason is kept on the batch
            and in the audit trail.
          </Alert>
          <Select
            label="Action"
            options={ADJUST_ACTIONS}
            value={adjustForm.action}
            onChange={(event) => setAdjustForm((prev) => ({ ...prev, action: event.target.value }))}
          />
          {adjustForm.action === 'write-off' && (
            <Input
              label="Quantity to write off"
              type="number"
              min="1"
              max={adjusting?.quantityOnHand}
              hint={adjusting ? `${adjusting.quantityOnHand} on hand` : undefined}
              value={adjustForm.quantity}
              onChange={(event) => setAdjustForm((prev) => ({ ...prev, quantity: event.target.value }))}
            />
          )}
          <Textarea
            label="Reason"
            required
            rows={2}
            value={adjustForm.reason}
            onChange={(event) => setAdjustForm((prev) => ({ ...prev, reason: event.target.value }))}
            placeholder="Damaged in transit, destroyed and witnessed…"
          />
        </div>
      </Modal>
    </div>
  );
}

export default DrugInventoryPage;
