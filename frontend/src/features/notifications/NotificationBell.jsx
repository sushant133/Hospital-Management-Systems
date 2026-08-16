import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { notificationApi } from '../../api/notificationApi.js';
import { formatDate } from '../../utils/format.js';

const RESOURCE_HREF = {
  LabOrder: (n) => n.resourceId ? `/lab/orders/${n.resourceId}` : '/lab',
  RadiologyOrder: (n) => n.resourceId ? `/radiology/orders/${n.resourceId}` : '/radiology',
  Appointment: () => '/appointments',
  Triage: () => '/emergency',
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const response = await notificationApi.list({ limit: 12 });
      setItems(response.data ?? []);
      setUnread(response.meta?.unread ?? 0);
    } catch {
      /* bell is best-effort */
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const markOne = async (item) => {
    if (!item.readAt) {
      await notificationApi.markRead(item._id).catch(() => {});
      setItems((prev) => prev.map((n) => (n._id === item._id ? { ...n, readAt: new Date().toISOString() } : n)));
      setUnread((n) => Math.max(0, n - 1));
    }
  };

  const markAll = async () => {
    await notificationApi.markAllRead().catch(() => {});
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    setUnread(0);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); if (!open) refresh(); }}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        aria-label="Notifications"
      >
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M10 2a6 6 0 00-6 6v2.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 10.586V8a6 6 0 00-6-6z" />
          <path d="M10 18a3 3 0 01-2.83-2h5.66A3 3 0 0110 18z" />
        </svg>
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unread > 0 && (
              <button type="button" className="text-xs text-brand-600 hover:underline" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <li className="px-3 py-8 text-center text-sm text-slate-400">Nothing yet.</li>
            )}
            {items.map((item) => {
              const href = RESOURCE_HREF[item.resourceType]?.(item);
              return (
                <li key={item._id} className={item.readAt ? 'bg-white' : 'bg-brand-50/60'}>
                  <Link
                    to={href || '#'}
                    onClick={() => { markOne(item); setOpen(false); }}
                    className="block px-3 py-2 hover:bg-slate-50"
                  >
                    <p className="text-sm font-medium text-slate-900">{item.title}</p>
                    {item.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.body}</p>}
                    <p className="mt-1 text-[11px] text-slate-400">{formatDate(item.createdAt, { withTime: true })}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
