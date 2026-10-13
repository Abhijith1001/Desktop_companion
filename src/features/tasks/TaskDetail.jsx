import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useTasks, useToasts } from '../../stores';
import { PriorityChip } from '../../components/ui';
import { formatWhen, relative, isOverdue, whenOf } from '../../utils/dates';

const HISTORY_LABEL = {
  COMPLETED: '✅ Done', DISMISSED: 'Dismissed', EXPIRED: 'No response', MISSED: 'Missed', PENDING: 'Upcoming',
  SUPERSEDED: 'Rescheduled', CANCELLED: 'Cancelled',
};

export default function TaskDetail({ id, onEdit, onClose }) {
  const tasks = useTasks((s) => s.tasks);
  const run = useTasks((s) => s.run);
  const toast = useToasts((s) => s.push);
  const [task, setTask] = useState(null);
  const [customSnooze, setCustomSnooze] = useState('');

  const summary = tasks.find((t) => t.id === id);
  useEffect(() => {
    let live = true;
    api.tasks.get(id).then((t) => live && setTask(t)).catch(() => live && setTask(null));
    return () => { live = false; };
  }, [id, summary?.updatedAt, summary?.nextOccurrenceAt, summary?.status]);

  if (!task) return <aside className="p-6 text-sm text-stone-500">Task not found.</aside>;
  const when = whenOf(task);
  const done = task.status === 'COMPLETED';

  const snooze = async (minutes) => {
    const until = await run(() => api.tasks.snooze(task.id, minutes));
    toast(`Snoozed until ${new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${task.title}"? This can't be undone.`)) return;
    await run(() => api.tasks.remove(task.id));
    toast('Task deleted');
    onClose();
  };

  return (
    <aside className="flex h-full flex-col gap-4 overflow-y-auto border-l border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900" aria-label="Task details">
      <div className="flex items-start gap-2">
        <h2 className={`flex-1 text-xl font-bold leading-tight ${done ? 'text-stone-400 line-through' : ''}`}>{task.title}</h2>
        <button type="button" className="btn-ghost px-2" onClick={onClose} aria-label="Close details">✕</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PriorityChip priority={task.priority} />
        {task.category && <span className="chip bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">{task.category}</span>}
        <span className={`chip ${done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : isOverdue(task) ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'}`}>
          {done ? 'Completed' : isOverdue(task) ? 'Overdue' : 'Pending'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {done
          ? <button type="button" className="btn-outline" onClick={() => run(() => api.tasks.reopen(task.id))}>↺ Reopen</button>
          : <button type="button" className="btn-primary" onClick={async () => { await run(() => api.tasks.complete(task.id)); toast(task.recurrence ? 'Done — next one scheduled' : 'Nice work! ✅'); }}>✓ Mark done</button>}
        <button type="button" className="btn-outline" onClick={() => onEdit(task)}>✎ Edit</button>
        <button type="button" className="btn-ghost text-red-600 dark:text-red-400" onClick={remove}>Delete</button>
      </div>

      {!done && when && (
        <div>
          <span className="label">Snooze reminder</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {[5, 10, 30, 60].map((m) => <button key={m} type="button" className="btn-outline px-2 py-1 text-xs" onClick={() => snooze(m)}>{m < 60 ? `${m} min` : '1 hour'}</button>)}
            <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const m = Number(customSnooze); if (m >= 1 && m <= 1440) { snooze(m); setCustomSnooze(''); } }}>
              <input type="number" min={1} max={1440} className="input w-20 py-1 text-xs" placeholder="min" aria-label="Custom snooze minutes"
                value={customSnooze} onChange={(e) => setCustomSnooze(e.target.value)} />
              <button type="submit" className="btn-ghost px-2 py-1 text-xs">Snooze</button>
            </form>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-stone-500">When</dt>
        <dd>{when ? <>{formatWhen(when)} <span className="text-stone-500">({relative(when)})</span></> : 'No date'}</dd>
        {task.dueAt && <><dt className="text-stone-500">Repeats</dt><dd>{task.recurrenceText}</dd></>}
        {task.dueAt && <><dt className="text-stone-500">Reminder</dt><dd>{task.leadMinutes ? `${task.leadMinutes} min before` : 'At the time'}</dd></>}
        {task.dueAt && <><dt className="text-stone-500">Time zone</dt><dd>{task.timeZone}</dd></>}
        {task.completedAt && <><dt className="text-stone-500">Completed</dt><dd>{formatWhen(task.completedAt)}</dd></>}
        <dt className="text-stone-500">Created</dt><dd>{formatWhen(task.createdAt)}</dd>
        <dt className="text-stone-500">Updated</dt><dd>{formatWhen(task.updatedAt)}</dd>
      </dl>

      {task.description && <div><span className="label">Description</span><p className="whitespace-pre-wrap text-sm">{task.description}</p></div>}
      {task.notes && <div><span className="label">Notes</span><p className="whitespace-pre-wrap text-sm">{task.notes}</p></div>}
      {task.link && (
        <div>
          <span className="label">Link</span>
          <button type="button" className="break-all text-left text-sm text-brand-700 underline dark:text-brand-300" onClick={() => api.app.openExternal(task.link)}>{task.link}</button>
        </div>
      )}

      {task.history?.length > 0 && (
        <div>
          <span className="label">Reminder history</span>
          <ul className="space-y-1 text-sm">
            {task.history.map((h) => (
              <li key={h.scheduledAt} className="flex justify-between gap-2 border-b border-stone-100 pb-1 dark:border-stone-800">
                <span>{formatWhen(h.scheduledAt)}{h.snoozedUntil && h.status === 'PENDING' ? ` · snoozed to ${new Date(h.snoozedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
                <span className="text-stone-500">{HISTORY_LABEL[h.status] || h.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
