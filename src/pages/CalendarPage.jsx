import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { useTasks } from '../stores';
import { navigate } from '../hooks/useRoute';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const keyOf = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const DOT = { HIGH: 'bg-red-500', MEDIUM: 'bg-amber-500', LOW: 'bg-stone-400' };

export default function CalendarPage() {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(() => keyOf(new Date()));
  const tasksVersion = useTasks((s) => s.tasks);

  // 6-week grid starting on Monday.
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((start.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);

  useEffect(() => {
    const from = new Date(days[0]);
    const to = new Date(days[41]); to.setHours(23, 59, 59, 999);
    let live = true;
    api.tasks.calendar(from.toISOString(), to.toISOString()).then((r) => live && setItems(r)).catch(() => {});
    return () => { live = false; };
  }, [days, tasksVersion]);

  const byDay = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      const k = keyOf(new Date(it.at));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return m;
  }, [items]);

  const shift = (n) => setMonth((m) => { const d = new Date(m); d.setMonth(d.getMonth() + n); return d; });
  const todayKey = keyOf(new Date());
  const selectedItems = byDay.get(selected) || [];
  const selectedDate = days.find((d) => keyOf(d) === selected);

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <header className="mb-4 flex items-center gap-2">
          <h1 className="mr-auto text-2xl font-bold">{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h1>
          <button type="button" className="btn-outline" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <button type="button" className="btn-outline" onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setMonth(d); setSelected(todayKey); }}>Today</button>
          <button type="button" className="btn-outline" onClick={() => shift(1)} aria-label="Next month">›</button>
        </header>

        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-stone-200 text-center text-xs font-semibold uppercase text-stone-500 dark:border-stone-800">
            {DAY_NAMES.map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7" role="grid">
            {days.map((d) => {
              const k = keyOf(d);
              const list = byDay.get(k) || [];
              const inMonth = d.getMonth() === month.getMonth();
              return (
                <button key={k} type="button" role="gridcell" aria-selected={selected === k} onClick={() => setSelected(k)}
                  aria-label={`${d.toDateString()}, ${list.length} tasks`}
                  className={`flex min-h-24 flex-col gap-1 border-b border-r border-stone-100 p-1.5 text-left align-top dark:border-stone-800 ${selected === k ? 'bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-stone-50 dark:hover:bg-stone-800/40'} ${inMonth ? '' : 'opacity-40'}`}>
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${k === todayKey ? 'bg-brand-500 text-stone-950' : ''}`}>{d.getDate()}</span>
                  {list.slice(0, 3).map((it, i) => (
                    <span key={i} className={`flex items-center gap-1 truncate text-[11px] ${it.status === 'COMPLETED' ? 'text-stone-400 line-through' : ''}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[it.priority]}`} />
                      <span className="truncate">{it.title}</span>
                    </span>
                  ))}
                  {list.length > 3 && <span className="text-[11px] text-stone-500">+{list.length - 3} more</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="w-80 shrink-0 overflow-y-auto border-l border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="mb-3 text-lg font-bold">{selectedDate?.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        {selectedItems.length === 0 && <p className="text-sm text-stone-500">Nothing scheduled.</p>}
        <ul className="space-y-1.5">
          {selectedItems.map((it, i) => (
            <li key={i}>
              <button type="button" onClick={() => navigate(`/tasks/${it.taskId}`)}
                className="flex w-full items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-left text-sm hover:border-brand-400 dark:border-stone-800">
                <span className={`h-2 w-2 rounded-full ${DOT[it.priority]}`} />
                <span className="w-16 shrink-0 text-xs text-stone-500">{new Date(it.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                <span className={`truncate ${it.status === 'COMPLETED' ? 'text-stone-400 line-through' : ''}`}>{it.title}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-primary mt-4 w-full" onClick={() => navigate('/tasks/new')}>+ New task</button>
      </aside>
    </div>
  );
}
