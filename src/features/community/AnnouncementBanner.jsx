import { useEffect, useState } from 'react';
import { api } from '../../services/api';

// News from the Desktop Buddy team (published from the admin panel).
export default function AnnouncementBanner() {
  const [list, setList] = useState([]);
  useEffect(() => {
    api.community.announcements().then(setList).catch(() => {});
    return api.community.onAnnouncements(setList);
  }, []);
  const a = list[0];
  if (!a) return null;

  return (
    <div className="toast-in mx-6 mt-4 flex items-start gap-3 rounded-2xl border border-brand-200 bg-brand-50/90 px-4 py-3 text-sm shadow-sm backdrop-blur dark:border-brand-800 dark:bg-brand-900/30" role="status">
      <span className="text-lg" aria-hidden="true">📣</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-stone-900 dark:text-stone-100">{a.title}</p>
        {(a.body || a.message) && <p className="mt-0.5 text-stone-600 dark:text-stone-300">{a.body || a.message}</p>}
        {a.link && (
          <button type="button" className="mt-1 inline-block font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={() => api.app.openExternal(a.link)}>
            Learn more →
          </button>
        )}
      </div>
      <button type="button" className="btn-ghost px-2" aria-label="Dismiss announcement" onClick={() => api.community.dismiss(a.id).catch(() => {})}>✕</button>
    </div>
  );
}
