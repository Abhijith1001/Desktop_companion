import { useMemo, useState } from 'react';
import { Modal, Field, Toggle } from '../../components/ui';
import { useSettings, useTasks } from '../../stores';
import { api } from '../../services/api';
import { WEEKDAYS, allTimeZones, fromUtcIso, toUtcIso } from '../../utils/dates';

const LEAD_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440];
const leadLabel = (m) => (m === 0 ? 'At the time' : m < 60 ? `${m} min before` : m === 1440 ? '1 day before' : `${m / 60} h before`);

function initialState(task, settings) {
  const zone = task?.timeZone || settings.timeZone;
  const soon = new Date(Date.now() + 60 * 60_000);
  soon.setMinutes(0, 0, 0);
  const { date, time } = task?.dueAt ? fromUtcIso(task.dueAt, zone) : fromUtcIso(soon.toISOString(), zone);
  const r = task?.recurrence || { type: 'none' };
  return {
    title: task?.title || '',
    description: task?.description || '',
    notes: task?.notes || '',
    link: task?.link || '',
    category: task?.category || '',
    priority: task?.priority || 'MEDIUM',
    hasDate: task ? !!task.dueAt : true,
    date, time, zone,
    repeat: r.type,
    interval: r.interval || 2,
    weekdays: r.weekdays || [],
    until: r.until || '',
    leadMinutes: task ? task.leadMinutes : settings.defaultLeadMinutes,
  };
}

export default function TaskEditor({ task, onClose, onSaved }) {
  const settings = useSettings((s) => s.settings);
  const tasks = useTasks((s) => s.tasks);
  const run = useTasks((s) => s.run);
  const [f, setF] = useState(() => initialState(task, settings));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const zones = useMemo(allTimeZones, []);
  const categories = useMemo(() => [...new Set(tasks.map((t) => t.category).filter(Boolean))].sort(), [tasks]);

  const needsWeekdays = ['weekly', 'weekdays', 'every_n_weeks'].includes(f.repeat);
  const toggleDay = (n) => set({ weekdays: f.weekdays.includes(n) ? f.weekdays.filter((d) => d !== n) : [...f.weekdays, n].sort() });

  async function save(e) {
    e.preventDefault();
    setError(null);
    const recurrence = !f.hasDate || f.repeat === 'none' ? null : {
      type: f.repeat,
      ...(f.repeat.startsWith('every_n') ? { interval: Number(f.interval) } : {}),
      ...(needsWeekdays && f.weekdays.length ? { weekdays: f.weekdays } : {}),
      ...(f.until ? { until: f.until } : {}),
    };
    const input = {
      title: f.title, description: f.description, notes: f.notes, link: f.link.trim(), category: f.category.trim(),
      priority: f.priority, timeZone: f.zone, recurrence,
      dueAt: f.hasDate ? toUtcIso(f.date, f.time, f.zone) : null,
      leadMinutes: f.hasDate ? Number(f.leadMinutes) : 0,
    };
    if (f.hasDate && !input.dueAt) { setError('Please enter a valid date and time.'); return; }
    setSaving(true);
    try {
      const saved = await run(() => (task ? api.tasks.update(task.id, input) : api.tasks.create(input)));
      onClose();
      onSaved?.(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={task ? 'Edit task' : 'New task'} onClose={onClose} wide>
      <form onSubmit={save} className="grid gap-4">
        <Field label="Title" htmlFor="t-title">
          <input id="t-title" className="input text-base" value={f.title} maxLength={200} required autoFocus
            placeholder="e.g. Submit the weekly report" onChange={(e) => set({ title: e.target.value })} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority" htmlFor="t-priority">
            <select id="t-priority" className="input" value={f.priority} onChange={(e) => set({ priority: e.target.value })}>
              <option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
            </select>
          </Field>
          <Field label="Category" htmlFor="t-cat">
            <input id="t-cat" className="input" list="t-cats" value={f.category} maxLength={50} placeholder="Work, Health…"
              onChange={(e) => set({ category: e.target.value })} />
            <datalist id="t-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
        </div>

        <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
          <Toggle label="Date & reminder" description="Your buddy will remind you at this time" checked={f.hasDate} onChange={(v) => set({ hasDate: v })} />
          {f.hasDate && (
            <div className="mt-2 grid gap-3">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Date" htmlFor="t-date">
                  <input id="t-date" type="date" className="input" value={f.date} required onChange={(e) => set({ date: e.target.value })} />
                </Field>
                <Field label="Time" htmlFor="t-time">
                  <input id="t-time" type="time" className="input" value={f.time} required onChange={(e) => set({ time: e.target.value })} />
                </Field>
                <Field label="Remind me" htmlFor="t-lead">
                  <select id="t-lead" className="input" value={f.leadMinutes} onChange={(e) => set({ leadMinutes: Number(e.target.value) })}>
                    {[...new Set([...LEAD_OPTIONS, Number(f.leadMinutes)])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{leadLabel(m)}</option>)}
                  </select>
                </Field>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[['In 15 min', 15], ['In 1 hour', 60], ['Tonight 8 PM', 'tonight'], ['Tomorrow 9 AM', 'tomorrow']].map(([label, v]) => (
                  <button key={label} type="button" className="chip border border-stone-300 hover:border-brand-500 dark:border-stone-700"
                    onClick={() => {
                      const d = new Date();
                      if (v === 'tonight') d.setHours(20, 0, 0, 0);
                      else if (v === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
                      else d.setTime(Date.now() + v * 60_000);
                      set({ ...fromUtcIso(d.toISOString(), f.zone) });
                    }}>{label}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Repeat" htmlFor="t-repeat">
                  <select id="t-repeat" className="input" value={f.repeat} onChange={(e) => set({ repeat: e.target.value })}>
                    <option value="none">Does not repeat</option>
                    <option value="daily">Every day</option>
                    <option value="weekdays">On selected weekdays</option>
                    <option value="weekly">Every week</option>
                    <option value="every_n_days">Every N days</option>
                    <option value="every_n_weeks">Every N weeks</option>
                  </select>
                </Field>
                <Field label="Time zone" htmlFor="t-zone">
                  <select id="t-zone" className="input" value={f.zone} onChange={(e) => set({ zone: e.target.value })}>
                    {zones.map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                </Field>
              </div>
              {f.repeat !== 'none' && (
                <div className="grid gap-3">
                  {f.repeat.startsWith('every_n') && (
                    <Field label={f.repeat === 'every_n_days' ? 'Every how many days' : 'Every how many weeks'} htmlFor="t-int">
                      <input id="t-int" type="number" min={1} max={365} className="input w-28" value={f.interval} onChange={(e) => set({ interval: e.target.value })} />
                    </Field>
                  )}
                  {needsWeekdays && (
                    <div>
                      <span className="label">{f.repeat === 'weekdays' ? 'On these days' : 'On these days (optional)'}</span>
                      <div className="flex flex-wrap gap-1.5" role="group">
                        {WEEKDAYS.map((d) => (
                          <button key={d.n} type="button" aria-pressed={f.weekdays.includes(d.n)} onClick={() => toggleDay(d.n)}
                            className={`h-9 w-11 rounded-lg border text-sm font-semibold ${f.weekdays.includes(d.n) ? 'border-brand-500 bg-brand-500 text-stone-950' : 'border-stone-300 dark:border-stone-700'}`}>
                            {d.short}
                          </button>
                        ))}
                        <button type="button" className="btn-ghost text-xs" onClick={() => set({ weekdays: [1, 2, 3, 4, 5] })}>Mon–Fri</button>
                      </div>
                    </div>
                  )}
                  <Field label="Ends on (optional)" htmlFor="t-until">
                    <input id="t-until" type="date" className="input w-48" value={f.until} onChange={(e) => set({ until: e.target.value })} />
                  </Field>
                </div>
              )}
            </div>
          )}
        </div>

        <Field label="Description" htmlFor="t-desc">
          <textarea id="t-desc" rows={2} className="input" value={f.description} maxLength={5000} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Notes" htmlFor="t-notes">
            <textarea id="t-notes" rows={2} className="input" value={f.notes} maxLength={5000} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
          <Field label="Link" htmlFor="t-link" hint="Opened from the reminder bubble">
            <input id="t-link" type="url" className="input" value={f.link} placeholder="https://…" onChange={(e) => set({ link: e.target.value })} />
          </Field>
        </div>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : task ? 'Save changes' : 'Add task'}</button>
        </div>
      </form>
    </Modal>
  );
}
