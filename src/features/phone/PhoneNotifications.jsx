import { useEffect, useState } from 'react';
import { api } from '../../services/api';

function ago(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// Live copy of the phone's notification panel. Refreshes every few seconds
// while a phone is connected; nothing is saved.
export default function PhoneNotifications({ className = '' }) {
  const [list, setList] = useState([]);
  const [, tick] = useState(0);

  useEffect(() => {
    api.phone.notifications().then(setList).catch(() => {});
    const off = api.phone.onNotifications(setList);
    const t = setInterval(() => tick((n) => n + 1), 30_000); // keep "5m" labels fresh
    return () => { off(); clearInterval(t); };
  }, []);

  return (
    <section className={`card flex min-h-0 flex-col p-4 ${className}`} aria-label="Phone notifications">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-semibold">Notifications</h2>
        {list.length > 0 && (
          <span className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
            Newest first
            <button type="button" className="btn-ghost min-h-0 px-2 py-0.5 text-xs" onClick={() => api.phone.clearNotifications().catch(() => {})}>Clear all</button>
          </span>
        )}
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-stone-500 dark:text-stone-400">Nothing here. New notifications from your connected phone show up within a few seconds.</p>
      ) : (
        <ul className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1" aria-live="polite">
          {list.map((n) => (
            <li key={n.id} className={`rounded-lg px-2 py-2 hover:bg-stone-100 dark:hover:bg-stone-800/60 ${n.cleared ? 'opacity-55' : ''}`}>
              <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                <span className="truncate font-semibold text-brand-600 dark:text-brand-400">{n.app}</span>
                {n.subText && <span className="truncate">· {n.subText}</span>}
                {n.cleared && <span className="shrink-0" title="Opened or dismissed on the phone">· cleared</span>}
                <span className="ml-auto shrink-0">{ago(n.when)}</span>
              </div>
              {n.title && <p className="truncate text-sm font-medium">{n.title}</p>}
              {n.text && <p className="line-clamp-2 wrap-break-word text-sm text-stone-600 dark:text-stone-300">{n.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
