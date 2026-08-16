import { Link } from 'react-router-dom';
import { APPOINTMENT_STATUS_TONES, toTimeLabel } from '../../../api/appointmentApi.js';
import { fullName } from '../../../utils/format.js';
import { Badge, Button, Card, Spinner } from '../../../components/ui/index.js';

/**
 * The walk-in board: who is waiting, in queue order.
 *
 * Kept separate from the booked-schedule table because the desk reads it
 * differently — the queue number is the identifier that gets called out, not
 * the clock time.
 */
export function QueueBoard({ queue, meta, loading, onCheckIn, canCheckIn, busyId }) {
  if (loading) return <Spinner label="Loading queue…" className="py-8" />;

  if (!queue?.length) {
    return (
      <Card>
        <p className="py-6 text-center text-sm text-slate-500">
          Nobody is waiting. Walk-ins appear here as they arrive.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-sm text-slate-600">
        <span>
          <span className="font-semibold text-slate-900">{meta?.waiting ?? 0}</span> waiting
        </span>
        <span>
          <span className="font-semibold text-slate-900">{meta?.inProgress ?? 0}</span> in progress
        </span>
        <span>
          <span className="font-semibold text-slate-900">{meta?.done ?? 0}</span> done
        </span>
      </div>

      <div className="space-y-2">
        {queue.map((entry) => (
          <div
            key={entry._id}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
              {entry.queueNumber}
            </div>

            <div className="min-w-0 flex-1">
              <Link
                to={`/patients/${entry.patientId?._id}`}
                className="font-medium text-slate-900 hover:text-brand-700"
              >
                {fullName(entry.patientId)}
              </Link>
              <div className="text-xs text-slate-500">
                {entry.patientId?.mrn} · arrived {toTimeLabel(entry.scheduledStart)}
                {entry.doctorId ? ` · ${fullName(entry.doctorId)}` : ' · unassigned'}
              </div>
              {entry.reason && (
                <div className="truncate text-xs text-slate-400">{entry.reason}</div>
              )}
            </div>

            <Badge tone={APPOINTMENT_STATUS_TONES[entry.status] ?? 'neutral'}>
              {entry.status}
            </Badge>

            {canCheckIn && entry.status === 'scheduled' && (
              <Button
                size="sm"
                variant="secondary"
                loading={busyId === entry._id}
                onClick={() => onCheckIn?.(entry)}
              >
                Check in
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default QueueBoard;
