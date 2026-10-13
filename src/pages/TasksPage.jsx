import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTasks, useToasts } from '../stores';
import { api } from '../services/api';
import { navigate } from '../hooks/useRoute';
import { isOverdue, isToday, whenOf } from '../utils/dates';
import TaskRow from '../features/tasks/TaskRow';
import TaskDetail from '../features/tasks/TaskDetail';
import TaskEditor from '../features/tasks/TaskEditor';
import QuickCapture from '../features/capture/QuickCapture';
import Icon from '../components/Icon';

const VIEWS = {
  today: { title: 'Today', empty: 'Nothing due today. Enjoy the quiet.', test: (t, now) => t.status === 'PENDING' && (isToday(whenOf(t)) || isOverdue(t, now)) },
  upcoming: { title: 'Upcoming', empty: 'No upcoming tasks.', test: (t, now) => t.status === 'PENDING' && whenOf(t) && Date.parse(whenOf(t)) > now },
  overdue: { title: 'Overdue', empty: 'Nothing overdue. Nicely done.', test: (t, now) => isOverdue(t, now) },
  completed: { title: 'Completed', empty: 'Completed tasks will show up here.', test: (t) => t.status === 'COMPLETED' },
  all: { title: 'All tasks', empty: 'No tasks yet. Add one with “New task”.', test: () => true },
};

const RANGES = {
  any: () => true,
  today: (iso) => isToday(iso),
  week: (iso, now) => iso && Date.parse(iso) >= now - 86_400_000 && Date.parse(iso) <= now + 7 * 86_400_000,
  month: (iso) => iso && new Date(iso).getMonth() === new Date().getMonth() && new Date(iso).getFullYear() === new Date().getFullYear(),
  none: (iso) => !iso,
};

// Sections a list is split into, in display order. Completed tasks go last.
const GROUPS = [
  { id: 'overdue', title: 'Overdue' },
  { id: 'today', title: 'Today' },
  { id: 'tomorrow', title: 'Tomorrow' },
  { id: 'week', title: 'Next 7 days' },
  { id: 'later', title: 'Later' },
  { id: 'none', title: 'No date' },
  { id: 'done', title: 'Completed' },
];

function groupOf(t, now) {
  if (t.status !== 'PENDING') return 'done';
  if (isOverdue(t, now)) return 'overdue';
  const iso = whenOf(t);
  if (!iso) return 'none';
  const day = new Date(iso); day.setHours(0, 0, 0, 0);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const days = Math.round((day - today) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 7) return 'week';
  return 'later';
}

const LAST_VIEW_KEY = 'buddy:lastView';
const rememberedView = () => { try { return localStorage.getItem(LAST_VIEW_KEY) || 'today'; } catch { return 'today'; } };

export default function TasksPage({ view: viewProp, selectedId, creating }) {
  const view = VIEWS[viewProp] ? viewProp : rememberedView();
  const { tasks, loaded, run } = useTasks();
  const toast = useToasts((s) => s.push);
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('any');
  const [category, setCategory] = useState('any');
  const [range, setRange] = useState('any');
  const [editing, setEditing] = useState(null);
  const [quickCapture, setQuickCapture] = useState(false);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => { if (viewProp) try { localStorage.setItem(LAST_VIEW_KEY, viewProp); } catch { /* ignore */ } }, [viewProp]);

  const categories = useMemo(() => [...new Set(tasks.map((t) => t.category).filter(Boolean))].sort(), [tasks]);

  const visible = useMemo(() => {
    const now = Date.now();
    const q = deferredQuery.trim().toLowerCase();
    return tasks.filter((t) => VIEWS[view].test(t, now)
      && (priority === 'any' || t.priority === priority)
      && (category === 'any' || t.category === category)
      && RANGES[range](whenOf(t), now)
      && (!q || `${t.title} ${t.description} ${t.notes} ${t.category}`.toLowerCase().includes(q)));
  }, [tasks, view, priority, category, range, deferredQuery]);

  const onToggle = useCallback(async (t) => {
    if (t.status === 'COMPLETED') await run(() => api.tasks.reopen(t.id));
    else {
      await run(() => api.tasks.complete(t.id));
      toast(t.recurrence && t.recurrence.type !== 'none' ? 'Done — next one scheduled ↻' : 'Nice work! ✅');
    }
  }, [run, toast]);
  const onOpen = useCallback((t) => navigate(`/tasks/${t.id}`), []);
  const close = () => navigate(`/tasks/view/${view}`);

  const filtered = priority !== 'any' || category !== 'any' || range !== 'any' || query;
  const clearFilters = () => { setQuery(''); setPriority('any'); setCategory('any'); setRange('any'); };

  // Split the list into dated sections (Overdue, Today, Tomorrow, …).
  const sections = useMemo(() => {
    const now = Date.now();
    const by = new Map();
    for (const t of visible) {
      const g = groupOf(t, now);
      if (!by.has(g)) by.set(g, []);
      by.get(g).push(t);
    }
    return GROUPS.filter((g) => by.has(g.id)).map((g) => ({ ...g, tasks: by.get(g.id) }));
  }, [visible]);
  const showHeadings = sections.length > 1 || (sections[0] && sections[0].title !== VIEWS[view].title);
  const pendingCount = visible.filter((t) => t.status === 'PENDING').length;
  const select = 'input min-h-8 min-w-0 flex-1 py-1 pr-7 text-[13px] sm:w-auto sm:flex-none';

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-6 sm:px-6 lg:pt-8">
          <header className="mb-5 flex flex-wrap items-end gap-3">
            <div className="mr-auto">
              <h1 className="page-title">{VIEWS[view].title}</h1>
              <p className="page-subtitle tabular" aria-live="polite">
                {!loaded ? 'Loading…' : view === 'completed' ? `${visible.length} completed` : `${pendingCount} open${filtered ? ' · filtered' : ''}`}
              </p>
            </div>
            <button type="button" className="btn-outline" onClick={() => setQuickCapture(true)} title="Quick add with natural language (Ctrl+Shift+Space)">
              Quick add <kbd className="hidden rounded bg-stone-100 px-1 font-sans text-[10px] text-stone-500 sm:inline dark:bg-stone-800 dark:text-stone-400">Ctrl ⇧ Space</kbd>
            </button>
          </header>

          <div className="mb-5 flex flex-wrap items-center gap-2" role="search">
            <label className="relative min-w-0 flex-[1_1_14rem]">
              <span className="sr-only">Search tasks</span>
              <Icon name="search" size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <input type="search" className="input min-h-8 py-1 pl-8 text-[13px]" placeholder="Search tasks…" autoComplete="off" spellCheck={false}
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className="flex w-full gap-2 sm:w-auto">
            <select className={select} aria-label="Priority filter" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="any">Any priority</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
            </select>
            {categories.length > 0 && (
              <select className={select} aria-label="Category filter" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="any">Any category</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <select className={select} aria-label="Date filter" value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="any">Any date</option><option value="today">Today</option><option value="week">Next 7 days</option>
              <option value="month">This month</option><option value="none">No date</option>
            </select>
            </div>
            {filtered && <button type="button" className="btn-ghost min-h-8 px-2 text-[13px]" onClick={clearFilters}>Clear</button>}
          </div>

          {!loaded && (
            <ul className="space-y-1" aria-hidden="true">
              {[64, 48, 72, 40].map((w) => (
                <li key={w} className="flex items-center gap-3 px-3 py-3">
                  <span className="skeleton h-4.5 w-4.5 rounded-full" />
                  <span className="flex-1 space-y-1.5"><span className="skeleton block h-3.5" style={{ width: `${w}%` }} /><span className="skeleton block h-2.5 w-28" /></span>
                </li>
              ))}
            </ul>
          )}

          {loaded && visible.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-stone-300 px-6 py-14 text-center dark:border-stone-700">
              <p className="text-sm text-stone-500 dark:text-stone-400">{filtered ? 'No tasks match these filters.' : VIEWS[view].empty}</p>
              {filtered
                ? <button type="button" className="btn-outline" onClick={clearFilters}>Clear filters</button>
                : <button type="button" className="btn-primary" onClick={() => navigate('/tasks/new')}><Icon name="plus" size={16} strokeWidth={2.25} />Add a task</button>}
            </div>
          )}

          <div className="space-y-6">
            {sections.map((s) => (
              <section key={s.id} aria-labelledby={showHeadings ? `grp-${s.id}` : undefined}>
                {showHeadings && (
                  <h2 id={`grp-${s.id}`} className={`section-label mb-1 flex items-center gap-2 px-3 ${s.id === 'overdue' ? 'text-red-600! dark:text-red-400!' : ''}`}>
                    {s.title}<span className="tabular font-medium normal-case tracking-normal text-stone-400">{s.tasks.length}</span>
                  </h2>
                )}
                <ul className="flex flex-col">
                  {s.tasks.map((t) => <TaskRow key={t.id} task={t} selected={t.id === selectedId} onOpen={onOpen} onToggle={onToggle} />)}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>

      {selectedId && (
        <>
          <div className="fixed inset-0 z-30 bg-stone-950/30 lg:hidden" onClick={close} aria-hidden="true" />
          <div className="fixed inset-y-0 right-0 z-30 w-full max-w-[400px] shadow-2xl lg:static lg:z-auto lg:w-[360px] lg:shadow-none xl:w-[400px]">
            <TaskDetail id={selectedId} onEdit={setEditing} onClose={close} />
          </div>
        </>
      )}

      {creating && <TaskEditor onClose={close} onSaved={(t) => { toast('Task added'); navigate(`/tasks/${t.id}`); }} />}
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} onSaved={() => toast('Saved')} />}
      {quickCapture && <QuickCapture onClose={() => setQuickCapture(false)} />}
    </div>
  );
}
