import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTasks, useToasts } from '../stores';
import { api } from '../services/api';
import { navigate } from '../hooks/useRoute';
import { isOverdue, isToday, whenOf } from '../utils/dates';
import TaskRow from '../features/tasks/TaskRow';
import TaskDetail from '../features/tasks/TaskDetail';
import TaskEditor from '../features/tasks/TaskEditor';

const VIEWS = {
  today: { title: 'Today', empty: 'Nothing due today. Enjoy! ☀️', test: (t, now) => t.status === 'PENDING' && (isToday(whenOf(t)) || isOverdue(t, now)) },
  upcoming: { title: 'Upcoming', empty: 'No upcoming tasks.', test: (t, now) => t.status === 'PENDING' && whenOf(t) && Date.parse(whenOf(t)) > now },
  overdue: { title: 'Overdue', empty: 'Nothing overdue — great job! 🎉', test: (t, now) => isOverdue(t, now) },
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

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{VIEWS[view].title}</h1>
          <span className="text-sm text-stone-500">{visible.length} task{visible.length === 1 ? '' : 's'}</span>
        </header>

        <div className="mb-4 flex flex-wrap gap-2" role="search">
          <input type="search" className="input max-w-xs flex-1" placeholder="Search tasks…" aria-label="Search tasks"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="input w-auto" aria-label="Priority filter" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="any">Any priority</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
          </select>
          <select className="input w-auto" aria-label="Category filter" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="any">Any category</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input w-auto" aria-label="Date filter" value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="any">Any date</option><option value="today">Today</option><option value="week">Next 7 days</option>
            <option value="month">This month</option><option value="none">No date</option>
          </select>
          {filtered && <button type="button" className="btn-ghost" onClick={() => { setQuery(''); setPriority('any'); setCategory('any'); setRange('any'); }}>Clear</button>}
        </div>

        {loaded && visible.length === 0 && (
          <div className="card grid place-items-center gap-2 px-6 py-14 text-center">
            <p className="text-stone-500">{filtered ? 'No tasks match these filters.' : VIEWS[view].empty}</p>
            {!filtered && <button type="button" className="btn-primary" onClick={() => navigate('/tasks/new')}>+ Add a task</button>}
          </div>
        )}
        <ul className="flex flex-col gap-1.5">
          {visible.map((t) => <TaskRow key={t.id} task={t} selected={t.id === selectedId} onOpen={onOpen} onToggle={onToggle} />)}
        </ul>
      </div>

      {selectedId && (
        <div className="w-[380px] shrink-0">
          <TaskDetail id={selectedId} onEdit={setEditing} onClose={close} />
        </div>
      )}

      {creating && <TaskEditor onClose={close} onSaved={(t) => { toast('Task added'); navigate(`/tasks/${t.id}`); }} />}
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} onSaved={() => toast('Saved')} />}
    </div>
  );
}
