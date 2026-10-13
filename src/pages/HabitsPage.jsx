import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHabits, useToasts } from '../stores';
import { Modal, Field } from '../components/ui';

const ICONS = ['⭐','🏃','💧','📚','🧘','🥗','💪','🎯','✍️','🎸','🌱','😴','🧹','💊','🧠','🎨','🗣️','🚴','🏊','🤸'];
const COLORS = ['#e8994a','#ef4444','#8b5cf6','#3b82f6','#10b981','#f59e0b','#ec4899','#06b6d4','#84cc16','#f97316'];
const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function weekDates() {
  const today = new Date();
  const dow = today.getDay();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - dow + i);
    return d.toISOString().slice(0, 10);
  });
}

function HabitForm({ habit, onClose, onSaved }) {
  const habits = useHabits();
  const [f, setF] = useState({
    name: habit?.name || '',
    description: habit?.description || '',
    icon: habit?.icon || '⭐',
    color: habit?.color || '#e8994a',
    frequency: habit?.frequency || 'daily',
    targetDays: habit?.targetDays || [1,2,3,4,5,6,7],
  });
  const [saving, setSaving] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));

  const toggleDay = (d) => {
    set({ targetDays: f.targetDays.includes(d)
      ? f.targetDays.filter((x) => x !== d)
      : [...f.targetDays, d].sort() });
  };

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (habit) await habits.update(habit.id, f);
      else await habits.create(f);
      onSaved?.();
      onClose();
    } catch (err) {
      useToasts.getState().push(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={habit ? 'Edit habit' : 'New habit'} onClose={onClose}>
      <form onSubmit={save} className="grid gap-4">
        <Field label="Name" htmlFor="h-name">
          <input id="h-name" className="input" required maxLength={200}
            value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Icon">
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {ICONS.map((ic) => (
                <button key={ic} type="button"
                  className={`h-8 w-8 rounded-lg text-lg transition-all ${f.icon === ic ? 'ring-2 ring-brand-500 scale-110' : 'hover:bg-stone-100 dark:hover:bg-stone-800'}`}
                  onClick={() => set({ icon: ic })}>{ic}</button>
              ))}
            </div>
          </Field>
          <Field label="Color">
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button key={c} type="button"
                  style={{ background: c }}
                  className={`h-7 w-7 rounded-full transition-all ${f.color === c ? 'ring-2 ring-offset-2 ring-stone-400 scale-110' : 'hover:scale-105'}`}
                  onClick={() => set({ color: c })} />
              ))}
            </div>
          </Field>
        </div>

        <Field label="Track on these days">
          <div className="flex gap-1.5 flex-wrap">
            {DAY_LABELS.map((d, i) => (
              <button key={i} type="button" aria-pressed={f.targetDays.includes(i)}
                onClick={() => toggleDay(i)}
                className={`h-9 w-10 rounded-lg border text-xs font-semibold transition-colors ${
                  f.targetDays.includes(i)
                    ? 'border-brand-500 bg-brand-500 text-stone-950'
                    : 'border-stone-200 dark:border-stone-700 hover:border-brand-300'
                }`}>{d}</button>
            ))}
          </div>
        </Field>

        <Field label="Description" htmlFor="h-desc">
          <textarea id="h-desc" className="input" rows={2} maxLength={500}
            value={f.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : habit ? 'Save changes' : 'Add habit'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function HabitsPage() {
  const { habits, completions, loaded, load, loadRange, toggle, remove } = useHabits();
  const toast = useToasts((s) => s.push);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const week = useMemo(() => weekDates(), []);
  const today = todayStr();
  const todayDOW = new Date().getDay();

  useEffect(() => {
    load();
    loadRange(week[0], week[6]);
  }, []);

  const isCompleted = useCallback((habitId, date) => {
    const s = completions[date];
    return s instanceof Set ? s.has(habitId) : false;
  }, [completions]);

  async function handleDelete(h) {
    if (!confirm(`Delete habit "${h.name}"? All history will be lost.`)) return;
    try { await remove(h.id); toast('Habit deleted'); } catch (err) { toast(err.message, 'error'); }
  }

  const activeHabits = habits.filter((h) => !h.archived && (h.targetDays.includes(todayDOW)));
  const allActive = habits.filter((h) => !h.archived);

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="page-title">Habits</h1>
          <p className="text-sm text-stone-500">Build routines that stick.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          + New habit
        </button>
      </header>

      {/* Today's habits */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Today — {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </h2>
        {loaded && activeHabits.length === 0 && (
          <div className="card p-8 text-center text-stone-500">
            <p className="text-3xl mb-2">🌱</p>
            <p>No habits for today. Add one to get started!</p>
          </div>
        )}
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {activeHabits.map((h) => {
            const done = isCompleted(h.id, today);
            return (
              <button key={h.id} type="button"
                onClick={() => toggle(h.id, today)}
                className={`group card flex items-center gap-3 p-4 text-left transition-all hover:scale-[1.01] active:scale-[.99] ${
                  done ? 'opacity-80' : ''
                }`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl transition-all"
                  style={{ background: done ? h.color : `${h.color}22`, border: `2px solid ${h.color}` }}>
                  {done ? '✓' : h.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`font-semibold leading-tight ${done ? 'line-through text-stone-400' : ''}`}>{h.name}</p>
                  {h.description && <p className="text-xs text-stone-500 truncate">{h.description}</p>}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400"
                    onClick={(e) => { e.stopPropagation(); setEditing(h); }}>✏️</button>
                  <button type="button" className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-stone-400"
                    onClick={(e) => { e.stopPropagation(); handleDelete(h); }}>🗑️</button>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Weekly view */}
      {allActive.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">This week</h2>
          <div className="card overflow-hidden">
            {/* Header row */}
            <div className="grid border-b border-stone-100 dark:border-stone-800"
              style={{ gridTemplateColumns: '1fr repeat(7, 2.5rem)' }}>
              <div className="p-3 text-xs font-semibold text-stone-400">Habit</div>
              {week.map((d, i) => {
                const wd = (i + new Date(d + 'T00:00').getDay()) % 7;
                const isToday = d === today;
                return (
                  <div key={d} className={`p-2 text-center ${isToday ? 'bg-brand-50 dark:bg-brand-900/20' : ''}`}>
                    <div className="text-[10px] font-semibold text-stone-400">{DAY_LABELS[new Date(d + 'T00:00').getDay()]}</div>
                    <div className={`text-xs font-bold mt-0.5 ${isToday ? 'text-brand-600' : 'text-stone-500'}`}>
                      {new Date(d + 'T00:00').getDate()}
                    </div>
                  </div>
                );
              })}
            </div>
            {allActive.map((h) => (
              <div key={h.id} className="grid items-center border-b border-stone-50 last:border-0 dark:border-stone-800/50 hover:bg-stone-50/50 dark:hover:bg-stone-800/20"
                style={{ gridTemplateColumns: '1fr repeat(7, 2.5rem)' }}>
                <div className="flex items-center gap-2 p-3">
                  <span className="text-lg">{h.icon}</span>
                  <span className="text-sm font-medium truncate">{h.name}</span>
                </div>
                {week.map((d) => {
                  const dow = new Date(d + 'T00:00').getDay();
                  const scheduled = h.targetDays.includes(dow);
                  const done = isCompleted(h.id, d);
                  const isFuture = d > today;
                  return (
                    <div key={d} className="flex justify-center p-2">
                      {scheduled ? (
                        <button type="button" disabled={isFuture}
                          onClick={() => !isFuture && toggle(h.id, d)}
                          className="flex h-6 w-6 items-center justify-center rounded-full transition-all"
                          style={done ? { background: h.color, color: '#fff' } : { border: `2px solid ${h.color}44` }}>
                          {done ? '✓' : ''}
                        </button>
                      ) : (
                        <span className="h-1 w-1 rounded-full bg-stone-200 dark:bg-stone-700 self-center" />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      )}

      {creating && <HabitForm onClose={() => setCreating(false)} onSaved={() => { load(); loadRange(week[0], week[6]); }} />}
      {editing && <HabitForm habit={editing} onClose={() => setEditing(null)} onSaved={() => { load(); loadRange(week[0], week[6]); }} />}
    </div>
  );
}