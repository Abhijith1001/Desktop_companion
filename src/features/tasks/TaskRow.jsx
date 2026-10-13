import { memo } from 'react';
import { PriorityChip } from '../../components/ui';
import { formatWhen, isOverdue, relative, whenOf } from '../../utils/dates';

function TaskRow({ task, selected, onOpen, onToggle }) {
  const when = whenOf(task);
  const overdue = isOverdue(task);
  const done = task.status === 'COMPLETED';

  return (
    <li>
      <div className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${selected ? 'border-brand-400 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/20' : 'border-stone-200 bg-white hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700'}`}>
        <button type="button" onClick={() => onToggle(task)} aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 text-[11px] font-bold ${done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-brand-500 text-transparent hover:text-brand-500'}`}>
          ✓
        </button>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(task)}>
          <span className={`block truncate text-sm font-medium ${done ? 'text-stone-400 line-through' : ''}`}>{task.title}</span>
          <span className={`flex flex-wrap items-center gap-x-2 text-xs ${overdue ? 'font-semibold text-red-600 dark:text-red-400' : 'text-stone-500 dark:text-stone-400'}`}>
            {when ? <span>{formatWhen(when)} · {relative(when)}</span> : <span>No date</span>}
            {task.recurrence && task.recurrence.type !== 'none' && <span title={task.recurrenceText}>↻ {task.recurrenceText}</span>}
            {task.leadMinutes > 0 && <span>🔔 {task.leadMinutes}m early</span>}
          </span>
        </button>
        {task.category && <span className="chip hidden bg-stone-100 text-stone-600 sm:inline-flex dark:bg-stone-800 dark:text-stone-300">{task.category}</span>}
        <PriorityChip priority={task.priority} />
      </div>
    </li>
  );
}

export default memo(TaskRow);
