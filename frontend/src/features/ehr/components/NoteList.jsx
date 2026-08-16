import { useState } from 'react';
import { ehrApi, NOTE_TYPE_LABELS } from '../../../api/ehrApi.js';
import { formatDate } from '../../../utils/format.js';
import {
  Alert, Badge, Button, Card, EmptyState, Modal, Spinner,
} from '../../../components/ui/index.js';

const SOAP_SECTIONS = [
  ['subjective', 'S'],
  ['objective', 'O'],
  ['assessment', 'A'],
  ['plan', 'P'],
];

function NoteBody({ note }) {
  if (note.noteType !== 'soap') {
    return <p className="whitespace-pre-wrap text-sm text-slate-700">{note.content}</p>;
  }

  return (
    <dl className="space-y-2">
      {SOAP_SECTIONS.filter(([key]) => (note[key] ?? '').trim()).map(([key, letter]) => (
        <div key={key} className="flex gap-3">
          <dt className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-xs font-bold text-slate-600">
            {letter}
          </dt>
          <dd className="whitespace-pre-wrap text-sm text-slate-700">{note[key]}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Signed notes, newest first.
 *
 * Only current versions are listed — the server excludes superseded ones by
 * default. An amended note carries a version badge that opens the full chain,
 * so the earlier wording is always one click away rather than hidden.
 */
export function NoteList({ notes, loading, canAmend, onAmend }) {
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState(null);

  const openHistory = async (note) => {
    setHistoryLoading(true);
    setError(null);
    try {
      const response = await ehrApi.noteHistory(note._id);
      setHistory(response.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  if (loading) return <Spinner label="Loading notes…" className="py-8" />;

  if (!notes?.length) {
    return (
      <EmptyState
        icon="📝"
        title="No notes yet"
        description="Signed clinical notes appear here. They cannot be edited or deleted — corrections are amendments."
      />
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert tone="error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {notes.map((note) => (
        <Card key={note._id}>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Badge tone="purple">{NOTE_TYPE_LABELS[note.noteType] ?? note.noteType}</Badge>
                {note.version > 1 && (
                  <button
                    type="button"
                    onClick={() => openHistory(note)}
                    className="text-xs font-medium text-amber-700 underline underline-offset-2"
                  >
                    amended · v{note.version} — see history
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {note.authorName ?? '—'}
                {note.authorRole ? ` (${note.authorRole})` : ''} ·{' '}
                {formatDate(note.signedAt, { withTime: true })}
              </p>
            </div>

            {canAmend && (
              <Button size="sm" variant="secondary" onClick={() => onAmend?.(note)}>
                Amend
              </Button>
            )}
          </div>

          <NoteBody note={note} />

          {note.amendmentReason && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span className="font-semibold">Amendment reason:</span> {note.amendmentReason}
            </p>
          )}
        </Card>
      ))}

      <Modal
        open={Boolean(history)}
        onClose={() => setHistory(null)}
        title="Amendment history"
        description="Every version, oldest first. Nothing is ever overwritten."
        size="lg"
      >
        {historyLoading ? (
          <Spinner label="Loading history…" className="py-8" />
        ) : (
          <div className="space-y-3">
            {(history ?? []).map((version, index) => (
              <div
                key={version._id}
                className={[
                  'rounded-lg border p-3',
                  index === (history?.length ?? 0) - 1
                    ? 'border-brand-300 bg-brand-50'
                    : 'border-slate-200 bg-slate-50',
                ].join(' ')}
              >
                <div className="mb-2 flex items-center gap-2">
                  <Badge tone={index === (history?.length ?? 0) - 1 ? 'success' : 'neutral'}>
                    v{version.version}
                    {index === (history?.length ?? 0) - 1 ? ' · current' : ' · superseded'}
                  </Badge>
                  <span className="text-xs text-slate-500">
                    {version.authorName} · {formatDate(version.signedAt, { withTime: true })}
                  </span>
                </div>
                <NoteBody note={version} />
                {version.amendmentReason && (
                  <p className="mt-2 text-xs text-amber-800">
                    <span className="font-semibold">Reason:</span> {version.amendmentReason}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

export default NoteList;
