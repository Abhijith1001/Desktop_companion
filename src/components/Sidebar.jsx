import { useMemo } from 'react';
import { useTasks, useSettings, useSync, useBookmarks, useProgress } from '../stores';
import { isOverdue, isToday, whenOf } from '../utils/dates';
import { navigate } from '../hooks/useRoute';
import { BuddyPreview } from './ui';

export function useCounts() {
  const tasks = useTasks((s) => s.tasks);
  return useMemo(() => {
    const now = Date.now();
    const pending = tasks.filter((t) => t.status === 'PENDING');
    return {
      today: pending.filter((t) => isToday(whenOf(t)) || isOverdue(t, now)).length,
      upcoming: pending.filter((t) => whenOf(t) && Date.parse(whenOf(t)) > now).length,
      overdue: pending.filter((t) => isOverdue(t, now)).length,
      completed: tasks.filter((t) => t.status === 'COMPLETED').length,
      all: tasks.length,
    };
  }, [tasks]);
}

const NAV = [
  { to: '/tasks/view/today', label: 'Today', icon: '☀️', count: 'today' },
  { to: '/tasks/view/upcoming', label: 'Upcoming', icon: '📅', count: 'upcoming' },
  { to: '/tasks/view/overdue', label: 'Overdue', icon: '⏰', count: 'overdue', alert: true },
  { to: '/tasks/view/completed', label: 'Completed', icon: '✅', count: 'completed' },
  { to: '/tasks/view/all', label: 'All tasks', icon: '🗂️', count: 'all' },
  { divider: true },
  { to: '/chat', label: 'Chat', icon: '💬' },
  { to: '/bookmarks', label: 'Bookmarks', icon: '🔖', count: 'bookmarks' },
  { to: '/notepad', label: 'Notepad', icon: '📝' },
  { to: '/calculator', label: 'Calculator', icon: '🧮' },
  { divider: true },
  { to: '/calendar', label: 'Calendar', icon: '🗓️' },
  { to: '/progress', label: 'Progress', icon: '🏆', count: 'streak' },
  { to: '/characters', label: 'Characters', icon: '🐾' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
  { to: '/account', label: 'Account & sync', icon: '☁️' },
];

export default function Sidebar({ path }) {
  const progress = useProgress((s) => s.state);
  const counts = { ...useCounts(), bookmarks: useBookmarks((s) => s.facets.total), streak: progress?.streak ? `🔥${progress.streak}` : 0 };
  const character = useSettings((s) => s.settings.character);
  const buddyName = useSettings((s) => s.settings.buddyName);
  const accessory = useSettings((s) => s.settings.accessory);
  const sync = useSync((s) => s.status);
  const active = (to) => path === to || (['/bookmarks', '/notepad'].includes(to) && path.startsWith(`${to}/`)) || (to === '/tasks/view/today' && (path === '/tasks' || /^\/tasks\/(?!view)/.test(path)));

  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-stone-200 bg-stone-100/70 p-3 dark:border-stone-800 dark:bg-stone-900/60" aria-label="Main">
      <button type="button" onClick={() => navigate('/characters')} className="mb-2 flex items-center gap-2 rounded-xl p-1 text-left hover:bg-stone-200/70 dark:hover:bg-stone-800">
        <BuddyPreview id={character} accessory={accessory} state="idle" size={0.38} />
        <span>
          <span className="block text-sm font-bold leading-tight">Desktop Buddy</span>
          <span className="block text-xs text-stone-500">{buddyName || window.CHARACTERS[character]?.name}{progress ? ` · Lv ${progress.level}` : ''}</span>
        </span>
      </button>

      <button type="button" className="btn-primary mb-3 w-full" onClick={() => navigate('/tasks/new')}>
        + New task <kbd className="ml-auto rounded bg-black/10 px-1 text-[10px] font-medium">Ctrl N</kbd>
      </button>

      <ul className="flex flex-col gap-0.5">
        {NAV.map((item, i) => item.divider
          ? <li key={i} className="my-2 border-t border-stone-200 dark:border-stone-800" />
          : (
            <li key={item.to}>
              <a href={`#${item.to}`} aria-current={active(item.to) ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium ${active(item.to) ? 'bg-white text-stone-950 shadow-sm dark:bg-stone-800 dark:text-white' : 'text-stone-600 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800/60'}`}>
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
                {item.count && !!counts[item.count] && (
                  <span className={`ml-auto rounded-full px-1.5 text-xs font-semibold ${item.alert ? 'bg-red-600 text-white' : 'text-stone-500'}`}>
                    {counts[item.count]}
                  </span>
                )}
              </a>
            </li>
          ))}
      </ul>

      <div className="mt-auto px-2 pt-3 text-xs text-stone-500">
        {sync?.signedIn
          ? <span title={sync.lastError || ''}>{sync.syncing ? '⟳ Syncing…' : sync.lastError ? '⚠ Sync issue' : sync.pending ? `☁ ${sync.pending} waiting to sync` : '☁ Synced'}</span>
          : <span>Local only</span>}
      </div>
    </nav>
  );
}
