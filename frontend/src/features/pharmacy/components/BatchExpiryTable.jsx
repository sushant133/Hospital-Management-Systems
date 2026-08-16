import { BATCH_STATUS_TONES, daysUntil, expiryTone } from '../../../api/pharmacyApi.js';
import { formatDate } from '../../../utils/format.js';
import {
  Badge, Button, EmptyState, Spinner, Table, TBody, TD, THead, TR, TRMessage,
} from '../../../components/ui/index.js';

const COLUMNS = [
  { key: 'drug', label: 'Drug' },
  { key: 'batch', label: 'Batch' },
  { key: 'expiry', label: 'Expires' },
  { key: 'qty', label: 'On hand' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '' },
];

/**
 * Stock by batch, soonest expiry first — the order the pharmacy works in.
 *
 * Expiry is colour-coded rather than merely dated: a table of dates makes the
 * reader do the arithmetic, and the whole point of the view is to notice what
 * is about to be lost.
 */
export function BatchExpiryTable({ batches, loading, canAdjust, onAdjust, emptyMessage }) {
  if (loading) return <Spinner label="Loading stock…" className="py-8" />;

  if (!batches?.length) {
    return (
      <EmptyState
        icon="📦"
        title="No stock recorded"
        description={emptyMessage ?? 'Batches appear here once goods are received.'}
      />
    );
  }

  return (
    <Table>
      <THead columns={COLUMNS} />
      <TBody>
        {batches.length === 0 && <TRMessage colSpan={COLUMNS.length}>Nothing to show.</TRMessage>}
        {batches.map((batch) => {
          const days = daysUntil(batch.expiryDate);
          return (
            <TR key={batch._id}>
              <TD>
                <div className="font-medium text-slate-900">{batch.drugId?.name ?? '—'}</div>
                <div className="text-xs text-slate-400">
                  {batch.drugId?.strength} {batch.drugId?.form}
                </div>
              </TD>
              <TD>
                <span className="font-mono text-xs text-slate-600">{batch.batchNo}</span>
              </TD>
              <TD>
                <div className="text-sm">{formatDate(batch.expiryDate)}</div>
                <Badge tone={expiryTone(batch.expiryDate)}>
                  {days <= 0 ? `expired ${Math.abs(days)}d ago` : `${days}d left`}
                </Badge>
              </TD>
              <TD>
                <span className="font-medium">{batch.quantityOnHand}</span>
                <span className="text-xs text-slate-400"> / {batch.quantityReceived}</span>
              </TD>
              <TD>
                <Badge tone={BATCH_STATUS_TONES[batch.status] ?? 'neutral'}>{batch.status}</Badge>
              </TD>
              <TD>
                {canAdjust && (
                  <div className="flex justify-end">
                    <Button size="sm" variant="secondary" onClick={() => onAdjust?.(batch)}>
                      Adjust
                    </Button>
                  </div>
                )}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

export default BatchExpiryTable;
