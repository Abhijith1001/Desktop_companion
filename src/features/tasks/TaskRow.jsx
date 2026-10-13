import { memo, useState } from 'react';
import Icon from '../../components/Icon';
import { formatWhen, isOverdue, relative, whenOf } from '../../utils/dates';

// One row in a grouped task list. Priority is only called out when it is high,
// so the list stays quiet and the important items stand out.
function TaskRow({ task, selected, onOpen, onToggle }) {
  const when = whenOf(task);
  const overdue = isOverdue(task);
  const [completing, setCompleting] = useState(false);
  const done = task.status === 'COMPLETED' || completing;
  const repeats = task.recurrence && task.recurrence.type !== 'none';

  // Completing: pop the check and slide the row out, then actually toggle.
  const toggle = () => {
    if (task.status === 'COMPLETED' || completing) return onToggle(task);
    setCompleting(true);
    setTimeout(() => { setCompleting(false); onToggle(task); }, 480);
  };

  return (
    <li className={`task-row ${completing ? 'completing' : ''}`}>
      <div className={`group relative flex items-center gap-1 rounded-lg pr-3 transition-colors ${selected
        ? 'bg-brand-50 ring-1 ring-brand-200 ring-inset dark:bg-brand-900/20 dark:ring-brand-800'
        : 'hover:bg-stone-100/80 dark:hover:bg-stone-800/50'}`}>
        <button type="button" onClick={toggle} disabled={completing}
          aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
          className="group/check grid h-11 w-11 shrink-0 place-items-center rounded-lg">
          <span className={`grid h-4.5 w-4.5 place-items-center rounded-full border-[1.5px] transition-colors ${done
            ? 'check-pop border-emerald-500 bg-emerald-500 text-white'
            : `${task.priority === 'HIGH' ? 'border-red-500' : 'border-stone-400 dark:border-stone-500'} text-transparent group-hover:text-stone-400 group-hover/check:border-brand-500! group-hover/check:text-brand-500!`}`}>
            <Icon name="check" size={12} strokeWidth={3} />
          </span>
        </button>
        <button type="button" className="min-w-0 flex-1 py-2 text-left" onClick={() => onOpen(task)} aria-current={selected ? 'true' : undefined}>
          <span className={`block truncate text-sm ${done ? 'text-stone-400 line-through dark:text-stone-500' : 'font-medium text-stone-900 dark:text-stone-100'}`}>{task.title}</span>
          <span className={`tabular mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs ${overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-stone-500 dark:text-stone-400'}`}>
            <span>{when ? `${formatWhen(when)} · ${relative(when)}` : 'No date'}</span>
            {repeats && <span className="inline-flex items-center gap-1" title={task.recurrenceText}><Icon name="repeat" size={12} />{task.recurrenceText}</span>}
            {task.leadMinutes > 0 && <span className="inline-flex items-center gap-1"><Icon name="bell" size={12} />{task.leadMinutes} min early</span>}
          </span>
        </button>
        {task.category && <span className="hidden max-w-40 truncate text-xs text-stone-500 sm:inline dark:text-stone-400">{task.category}</span>}
        {task.priority === 'HIGH' && !done && (
          <span className="ml-2 text-red-500" title="High priority"><Icon name="flag" size={15} /><span className="sr-only">High priority</span></span>
        )}
      </div>
    </li>
  );
}

export default memo(TaskRow);
