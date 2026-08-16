import { useCallback, useEffect, useState } from 'react';
import {
  inventoryApi,
  CATEGORY_OPTIONS,
  TRANSACTION_TONES,
} from '../../../api/inventoryApi.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import { formatDate, fullName } from '../../../utils/format.js';
import StockMovementModal from '../components/StockMovementModal.jsx';
import {
  Alert, Badge, Button, Card, CardHeader, Input, Modal, PageHeader, Select, Spinner,
  Table, TBody, TD, THead, TR, TRMessage, Textarea,
} from '../../../components/ui/index.js';

const ITEM_COLUMNS = [
  { key: 'item', label: 'Item' },
  { key: 'category', label: 'Category' },
  { key: 'stock', label: 'On hand' },
  { key: 'value', label: 'Value' },
  { key: 'location', label: 'Location' },
  { key: 'actions', label: '' },
];

const LEDGER_COLUMNS = [
  { key: 'when', label: 'When' },
  { key: 'item', label: 'Item' },
  { key: 'type', label: 'Movement' },
  { key: 'qty', label: 'Qty' },
  { key: 'balance', label: 'Balance' },
  { key: 'dept', label: 'Department' },
  { key: 'by', label: 'By' },
];

const TABS = [
  { key: 'items', label: 'Items' },
  { key: 'ledger', label: 'Stock ledger' },
  { key: 'consumption', label: 'Consumption' },
  { key: 'alerts', label: 'Alerts' },
];

const EMPTY_ITEM = {
  itemCode: '', name: '', description: '', category: 'consumable', unit: '',
  reorderLevel: '', unitCost: '', location: '', isAsset: false, supplier: '',
};

/**
 * The general store: non-drug consumables and assets, the ledger behind the
 * balances, and what the wards are getting through.
 */
export function InventoryListPage() {
  const { can } = useAuth();
  const canManage = can(MODULES.INVENTORY, 'create');
  const canTransact = can(MODULES.INVENTORY, 'transact');

  const [tab, setTab] = useState('items');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const [items, setItems] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [consumption, setConsumption] = useState(null);
  const [alerts, setAlerts] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [moving, setMoving] = useState(null);
  const [itemModal, setItemModal] = useState(false);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'items') {
        const response = await inventoryApi.listItems({
          search: search || undefined,
          category: category || undefined,
          lowStockOnly: lowStockOnly ? 'true' : undefined,
          limit: 200,
        });
        setItems(response.data);
      } else if (tab === 'ledger') {
        const response = await inventoryApi.listTransactions({ limit: 100 });
        setLedger(response.data);
      } else if (tab === 'consumption') {
        setConsumption(await inventoryApi.consumption({}));
      } else {
        setAlerts(await inventoryApi.alerts());
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tab, search, category, lowStockOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key) => (event) =>
    setItemForm((prev) => ({
      ...prev,
      [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
    }));

  const saveItem = async () => {
    setFormError(null);
    setSaving(true);
    try {
      const response = await inventoryApi.createItem({
        ...itemForm,
        reorderLevel: Number(itemForm.reorderLevel || 0),
        unitCost: Number(itemForm.unitCost || 0),
      });
      setNotice(response.message);
      setItemModal(false);
      setItemForm(EMPTY_ITEM);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Non-drug consumables and assets — the store, its ledger and what the wards consume."
        action={
          canManage && (
            <Button onClick={() => { setItemForm(EMPTY_ITEM); setFormError(null); setItemModal(true); }}>
              Add item
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

      {tab === 'items' && (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <input
              type="search"
              className="form-control max-w-xs"
              placeholder="Search by name or code…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="w-48">
              <Select
                options={CATEGORY_OPTIONS}
                placeholder="Any category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-label="Filter by category"
              />
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={lowStockOnly}
                onChange={(event) => setLowStockOnly(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Needs reorder
            </label>
          </div>

          <Table>
            <THead columns={ITEM_COLUMNS} />
            <TBody>
              {loading && <TRMessage colSpan={ITEM_COLUMNS.length}>Loading items…</TRMessage>}
              {!loading && items.length === 0 && (
                <TRMessage colSpan={ITEM_COLUMNS.length}>No items match.</TRMessage>
              )}
              {!loading &&
                items.map((item) => {
                  const low = item.reorderLevel > 0 && item.quantityOnHand <= item.reorderLevel;
                  return (
                    <TR key={item._id}>
                      <TD>
                        <div className="font-medium text-slate-900">{item.name}</div>
                        <div className="text-xs text-slate-400">{item.itemCode}</div>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone="neutral">{item.category}</Badge>
                          {item.isAsset && <Badge tone="purple">asset</Badge>}
                        </div>
                      </TD>
                      <TD>
                        <span className={low ? 'font-semibold text-amber-700' : ''}>
                          {item.quantityOnHand}
                        </span>
                        <span className="text-xs text-slate-400"> {item.unit}</span>
                        {low && <Badge tone="warning" className="ml-1">reorder</Badge>}
                      </TD>
                      <TD>{(item.quantityOnHand * (item.unitCost ?? 0)).toFixed(2)}</TD>
                      <TD>
                        <span className="text-sm text-slate-600">{item.location || '—'}</span>
                      </TD>
                      <TD>
                        {canTransact && (
                          <div className="flex justify-end">
                            <Button size="sm" variant="secondary" onClick={() => setMoving(item)}>
                              Move stock
                            </Button>
                          </div>
                        )}
                      </TD>
                    </TR>
                  );
                })}
            </TBody>
          </Table>
        </>
      )}

      {tab === 'ledger' && (
        <Table>
          <THead columns={LEDGER_COLUMNS} />
          <TBody>
            {loading && <TRMessage colSpan={LEDGER_COLUMNS.length}>Loading ledger…</TRMessage>}
            {!loading && ledger.length === 0 && (
              <TRMessage colSpan={LEDGER_COLUMNS.length}>No movements recorded.</TRMessage>
            )}
            {!loading &&
              ledger.map((row) => (
                <TR key={row._id}>
                  <TD>
                    <span className="whitespace-nowrap text-sm">
                      {formatDate(row.occurredAt, { withTime: true })}
                    </span>
                  </TD>
                  <TD>
                    <div className="text-sm font-medium text-slate-900">{row.itemName}</div>
                    <div className="text-xs text-slate-400">{row.itemId?.itemCode}</div>
                  </TD>
                  <TD>
                    <Badge tone={TRANSACTION_TONES[row.type] ?? 'neutral'}>{row.type}</Badge>
                  </TD>
                  <TD>
                    <span
                      className={
                        row.signedQuantity < 0 ? 'font-medium text-red-700' : 'font-medium text-emerald-700'
                      }
                    >
                      {row.signedQuantity > 0 ? '+' : ''}
                      {row.signedQuantity}
                    </span>
                  </TD>
                  <TD>{row.balanceAfter}</TD>
                  <TD>{row.departmentId?.name ?? '—'}</TD>
                  <TD>
                    <span className="text-xs text-slate-500">{fullName(row.performedBy)}</span>
                  </TD>
                </TR>
              ))}
          </TBody>
        </Table>
      )}

      {tab === 'consumption' && (
        loading ? (
          <Spinner label="Building the report…" className="py-10" />
        ) : (
          <div>
            <CardHeader
              title="Consumption by department"
              description={
                consumption?.meta
                  ? `${consumption.meta.totalUnits} unit(s) consumed, value ${consumption.meta.totalValue} — net of returns`
                  : undefined
              }
            />
            {(consumption?.data ?? []).length === 0 ? (
              <Card><p className="py-6 text-center text-sm text-slate-500">Nothing has been issued yet.</p></Card>
            ) : (
              <div className="space-y-2">
                {consumption.data.map((row) => (
                  <Card key={String(row.departmentId)} className="!p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{row.department}</p>
                        <p className="text-xs text-slate-500">{row.movements} movement(s)</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-slate-900">{row.quantityUsed}</p>
                        <p className="text-xs text-slate-500">value {row.value}</p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {tab === 'alerts' && (
        loading ? (
          <Spinner label="Checking stock…" className="py-10" />
        ) : (
          <div>
            <CardHeader
              title="Needs reordering"
              description={
                alerts?.meta
                  ? `${alerts.meta.lowStockCount} at or below reorder level · ${alerts.meta.outOfStockCount} out of stock · store valued at ${alerts.meta.valuation?.value}`
                  : undefined
              }
            />
            {(alerts?.data?.lowStock ?? []).length === 0 ? (
              <Card><p className="py-6 text-center text-sm text-slate-500">Everything is above its reorder level.</p></Card>
            ) : (
              <div className="space-y-2">
                {alerts.data.lowStock.map((item) => (
                  <Card key={item._id} className="!p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-500">
                          {item.quantityOnHand} {item.unit} in stock · reorder at {item.reorderLevel}
                          {item.location ? ` · ${item.location}` : ''}
                        </p>
                      </div>
                      <Badge tone={item.quantityOnHand === 0 ? 'danger' : 'warning'}>
                        {item.quantityOnHand === 0 ? 'out of stock' : `short ${item.shortBy}`}
                      </Badge>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )
      )}

      <StockMovementModal
        open={Boolean(moving)}
        item={moving}
        onClose={() => setMoving(null)}
        onDone={(response) => {
          setNotice(response.message);
          load();
        }}
      />

      <Modal
        open={itemModal}
        onClose={() => setItemModal(false)}
        title="Add an inventory item"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setItemModal(false)}>Cancel</Button>
            <Button loading={saving} onClick={saveItem}>Add item</Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError && <Alert tone="error">{formError}</Alert>}
          <Alert tone="info">
            Stock arrives through a receipt, not by typing a number here — that is what keeps the
            ledger and the balance in step.
          </Alert>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Item code" required value={itemForm.itemCode} onChange={set('itemCode')} placeholder="GLV-M" />
            <Input label="Name" required value={itemForm.name} onChange={set('name')} placeholder="Nitrile gloves, medium" />
            <Select label="Category" options={CATEGORY_OPTIONS} value={itemForm.category} onChange={set('category')} />
            <Input label="Unit" required value={itemForm.unit} onChange={set('unit')} placeholder="box" />
            <Input label="Reorder level" type="number" value={itemForm.reorderLevel} onChange={set('reorderLevel')} />
            <Input label="Unit cost" type="number" step="0.01" value={itemForm.unitCost} onChange={set('unitCost')} />
            <Input label="Location" value={itemForm.location} onChange={set('location')} placeholder="Central store" />
            <Input label="Supplier" value={itemForm.supplier} onChange={set('supplier')} />
          </div>
          <Textarea label="Description" rows={2} value={itemForm.description} onChange={set('description')} />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={itemForm.isAsset} onChange={set('isAsset')} />
            Durable asset — expected back when issued (not consumed)
          </label>
        </div>
      </Modal>
    </div>
  );
}

export default InventoryListPage;
