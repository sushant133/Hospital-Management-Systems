import { useCallback, useEffect, useState } from 'react';
import { purchaseApi } from '../../../api/tier23Api.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { MODULES } from '../../../utils/permissions.js';
import {
  Alert, Badge, Button, Input, Modal, PageHeader, Select, Spinner,
  Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

export function PurchasePage() {
  const { can } = useAuth();
  const [tab, setTab] = useState('pos');
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ supplierId: '', description: '', quantity: 1, unitCost: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [po, sup] = await Promise.all([
        purchaseApi.listOrders({ limit: 100 }),
        purchaseApi.listSuppliers({ limit: 100 }),
      ]);
      setOrders(po.data);
      setSuppliers(sup.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      const response = await purchaseApi.createOrder({
        supplierId: form.supplierId,
        lines: [{ description: form.description, quantity: Number(form.quantity), unitCost: Number(form.unitCost) }],
      });
      setNotice(response.message);
      setOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        description="Suppliers and goods-in. Receiving posts to the general store when a line is linked to an item."
        action={can(MODULES.PURCHASE, 'create') && <Button onClick={() => setOpen(true)}>Draft PO</Button>}
      />
      <div className="mb-4 flex gap-2">
        <Button variant={tab === 'pos' ? 'primary' : 'secondary'} onClick={() => setTab('pos')}>Orders</Button>
        <Button variant={tab === 'sup' ? 'primary' : 'secondary'} onClick={() => setTab('sup')}>Suppliers</Button>
      </div>
      {notice && <Alert tone="success" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert tone="error" className="mb-4" onDismiss={() => setError(null)}>{error}</Alert>}
      {loading ? <Spinner className="py-12" /> : tab === 'pos' ? (
        <Table>
          <THead columns={[{ key: 'n', label: 'PO' }, { key: 's', label: 'Supplier' }, { key: 'st', label: 'Status' }, { key: 'a', label: '' }]} />
          <TBody>
            {orders.map((row) => (
              <TR key={row._id}>
                <TD className="font-mono text-xs">{row.poNumber}</TD>
                <TD>{row.supplierId?.name}</TD>
                <TD><Badge>{row.status}</Badge></TD>
                <TD>
                  {row.status === 'draft' && can(MODULES.PURCHASE, 'edit') && (
                    <Button size="sm" onClick={async () => { try { setNotice((await purchaseApi.submit(row._id)).message); load(); } catch (e) { setError(e.message); } }}>Submit</Button>
                  )}
                </TD>
              </TR>
            ))}
            {orders.length === 0 && <TRMessage colSpan={4}>No purchase orders.</TRMessage>}
          </TBody>
        </Table>
      ) : (
        <Table>
          <THead columns={[{ key: 'c', label: 'Code' }, { key: 'n', label: 'Name' }, { key: 'k', label: 'Kind' }]} />
          <TBody>
            {suppliers.map((s) => (
              <TR key={s._id}>
                <TD>{s.code}</TD>
                <TD>{s.name}</TD>
                <TD>{s.kind}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Draft purchase order" footer={<Button onClick={create}>Create</Button>}>
        <Select label="Supplier" value={form.supplierId} onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}>
          <option value="">Choose…</option>
          {suppliers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
        </Select>
        <Input className="mt-3" label="Item" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Input label="Qty" type="number" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
          <Input label="Unit cost" type="number" value={form.unitCost} onChange={(e) => setForm((f) => ({ ...f, unitCost: e.target.value }))} />
        </div>
      </Modal>
    </div>
  );
}

export default PurchasePage;
