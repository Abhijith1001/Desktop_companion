import { useMemo, useState } from 'react';
import { useTasks, useSettings, useSync, useBookmarks, useProgress } from '../stores';
import { isOverdue, isToday, whenOf } from '../utils/dates';
import { navigate } from '../hooks/useRoute';
import { BuddyPreview } from './ui';
import Icon from './Icon';
import FeedbackDialog from '../features/community/FeedbackDialog';
import WellnessWidget from '../features/wellness/WellnessWidget';

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
  { group: 'Tasks' },
  { to: '/tasks/view/today', label: 'Today', icon: 'sun', count: 'today' },
  { to: '/tasks/view/upcoming', label: 'Upcoming', icon: 'calendarClock', count: 'upcoming' },
  { to: '/tasks/view/overdue', label: 'Overdue', icon: 'alarm', count: 'overdue', alert: true },
  { to: '/tasks/view/completed', label: 'Completed', icon: 'checkCircle', count: 'completed' },
  { to: '/tasks/view/all', label: 'All tasks', icon: 'list', count: 'all' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { group: 'Focus' },
  { to: '/habits', label: 'Habits', icon: 'flame' },
  { to: '/pomodoro', label: 'Focus mode', icon: 'timer' },
  { group: 'Tools' },
  { to: '/chat', label: 'Chat', icon: 'message' },
  { to: '/phone', label: 'Phone', icon: 'phone' },
  { to: '/bookmarks', label: 'Bookmarks', icon: 'bookmark', count: 'bookmarks' },
  { to: '/notepad', label: 'Notepad', icon: 'note' },
  { to: '/calculator', label: 'Calculator', icon: 'calculator' },
  { group: 'You' },
  { to: '/progress', label: 'Progress', icon: 'trophy', count: 'streak' },
  { to: '/characters', label: 'Characters', icon: 'paw' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
  { to: '/account', label: 'Account & sync', icon: 'cloud' },
];

// Labels hidden in the icon-rail range (md–lg) but kept for screen readers.
const LABEL = 'md:max-lg:sr-only';

// One sidebar instance for every width, so its widgets keep their state:
//   lg+    full sidebar with labels
//   md–lg  icon rail; labels become tooltips
//   < md   off-canvas drawer opened from the top bar in App
export default function Sidebar({ path, open = false, onClose = () => {} }) {
  const progress = useProgress((s) => s.state);
  const counts = { ...useCounts(), bookmarks: useBookmarks((s) => s.facets.total), streak: progress?.streak || 0 };
  const character = useSettings((s) => s.settings.character);
  const buddyName = useSettings((s) => s.settings.buddyName);
  const accessory = useSettings((s) => s.settings.accessory);
  const sync = useSync((s) => s.status);
  const [feedback, setFeedback] = useState(false);
  const active = (to) => path === to || (['/bookmarks', '/notepad'].includes(to) && path.startsWith(`${to}/`)) || (to === '/tasks/view/today' && (path === '/tasks' || /^\/tasks\/(?!view)/.test(path)));
  const syncText = sync?.signedIn
    ? (sync.syncing ? 'Syncing…' : sync.lastError ? 'Sync issue' : sync.pending ? `${sync.pending} waiting to sync` : 'Synced')
    : 'Local only';
  const syncDot = sync?.signedIn ? (sync.lastError ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-stone-400';

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-stone-950/40 md:hidden" onClick={onClose} aria-hidden="true" />}
      <nav id="main-nav" aria-label="Main"
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-stone-200 bg-stone-100 p-3 transition-transform duration-200 md:static md:z-auto md:w-17 md:translate-x-0 md:px-2.5 lg:w-60 lg:px-3 dark:border-stone-800 dark:bg-stone-900 ${open ? 'translate-x-0 shadow-2xl' : 'max-md:-translate-x-full max-md:invisible'}`}>
        <div className="mb-3 flex items-center gap-1">
          <button type="button" onClick={() => navigate('/characters')} title="Characters"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left hover:bg-stone-200/70 md:max-lg:justify-center dark:hover:bg-stone-800">
            <span className="grid h-10 w-11 shrink-0 place-items-center overflow-hidden">
              <BuddyPreview id={character} accessory={accessory} state="idle" size={0.34} />
            </span>
            <span className={`min-w-0 ${LABEL}`}>
              <span className="block truncate text-sm font-semibold leading-tight">{buddyName || window.CHARACTERS[character]?.name}</span>
              <span className="block text-xs text-stone-500 dark:text-stone-400">{progress ? `Level ${progress.level}` : 'Desktop Buddy'}</span>
            </span>
          </button>
          <button type="button" className="btn-ghost px-2 md:hidden" onClick={onClose} aria-label="Close menu"><Icon name="x" /></button>
        </div>

        <button type="button" className="btn-primary mb-4 w-full md:max-lg:px-0" onClick={() => navigate('/tasks/new')} title="New task (Ctrl+N)">
          <Icon name="plus" size={16} strokeWidth={2.25} />
          <span className={LABEL}>New task</span>
          <kbd className="ml-auto rounded bg-black/10 px-1.5 font-sans text-[10px] font-medium md:max-lg:hidden">Ctrl N</kbd>
        </button>

        <ul className="flex flex-col gap-px">
          {NAV.map((item) => (item.group
            ? (
              <li key={item.group} className="mt-3 first:mt-0" role="presentation">
                <span className={`section-label block px-2.5 pb-1 ${LABEL}`}>{item.group}</span>
                <span className="mx-2 mb-1 hidden border-t border-stone-200 md:max-lg:block dark:border-stone-800" aria-hidden="true" />
              </li>
            )
            : (
              <li key={item.to}>
                <a href={`#${item.to}`} aria-current={active(item.to) ? 'page' : undefined} title={item.label}
                  className={`relative flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors md:max-lg:justify-center ${active(item.to)
                    ? 'bg-white text-stone-950 shadow-[0_1px_2px_rgb(28_25_23/0.08)] dark:bg-stone-800 dark:text-white'
                    : 'text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100'}`}>
                  <Icon name={item.icon} className={active(item.to) ? 'text-brand-600 dark:text-brand-400' : ''} />
                  <span className={LABEL}>{item.label}</span>
                  {item.count && !!counts[item.count] && (
                    <span className={`tabular ml-auto text-xs font-semibold ${item.alert
                      ? 'rounded-full bg-red-600 px-1.5 text-white md:max-lg:absolute md:max-lg:right-0.5 md:max-lg:top-0.5 md:max-lg:ml-0 md:max-lg:px-1 md:max-lg:text-[10px]'
                      : 'text-stone-400 md:max-lg:hidden dark:text-stone-500'}`}>
                      {counts[item.count]}
                    </span>
                  )}
                </a>
              </li>
            )))}
        </ul>

        <div className="mt-auto pt-2">
          <WellnessWidget labelClass={LABEL} />
        </div>

        <button type="button" title="Send feedback" onClick={() => setFeedback(true)}
          className="mt-2 flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 md:max-lg:mt-auto md:max-lg:justify-center dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100">
          <Icon name="feedback" /><span className={LABEL}>Send feedback</span>
        </button>
        {feedback && <FeedbackDialog onClose={() => setFeedback(false)} />}

        <p className="flex items-center gap-1.5 px-2.5 pt-2 text-xs text-stone-500 md:max-lg:justify-center dark:text-stone-400" title={sync?.lastError || syncText}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${syncDot}`} aria-hidden="true" />
          <span className={LABEL}>{syncText}</span>
        </p>
      </nav>
    </>
  );
}
