import { useEffect, useRef, useState } from 'react';
import { useTasks, useToasts, useSettings } from '../../stores';
import { api } from '../../services/api';
import { parseNL } from '../../utils/parseNL';
import { navigate } from '../../hooks/useRoute';
import { toUtcIso } from '../../utils/dates';

/**
 * Spotlight-style quick-capture overlay.
 * Opens on Ctrl+Shift+Space or when navigated to /quick-capture.
 */
export default function QuickCapture({ onClose }) {
  const [value, setValue] = useState('');
  const [parsed, setParsed] = useState(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const run = useTasks((s) => s.run);
  const toast = useToasts((s) => s.push);
  const settings = useSettings((s) => s.settings);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < 3) { setParsed(null); return; }
    const result = parseNL(trimmed);
    setParsed(result);
  }, [value]);

  async function handleSave(e) {
    e.preventDefault();
    if (!parsed?.title) return;
    setSaving(true);
    try {
      const zone = settings.timeZone;
      const dueAt = parsed.date && parsed.time ? toUtcIso(parsed.date, parsed.time, zone) : null;
      const task = await run(() => api.tasks.create({
        title: parsed.title,
        description: '',
        notes: '',
        link: '',
        category: '',
        priority: 'MEDIUM',
        dueAt,
        timeZone: zone,
        recurrence: parsed.recurrence && parsed.recurrence.type !== 'none'
          ? parsed.recurrence : null,
        leadMinutes: settings.defaultLeadMinutes || 10,
      }));
      toast('Task added ✅');
      onClose();
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const hasDate = parsed?.date;
  const hasTime = parsed?.time;
  const hasRecurrence = parsed?.recurrence;

  function fmt(date, time) {
    if (!date) return null;
    const d = new Date(date + (time ? `T${time}` : 'T00:00'));
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
      + (time ? ` at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-stone-950/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl px-4">
        <form onSubmit={handleSave}
          className="card overflow-hidden shadow-2xl"
          style={{ boxShadow: '0 32px 80px -12px rgba(0,0,0,0.4)' }}>
          {/* Search bar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100 dark:border-stone-800">
            <span className="text-xl">⚡</span>
            <input ref={inputRef} type="text"
              className="flex-1 bg-transparent text-lg outline-none placeholder:text-stone-400"
              placeholder='Quick add… "call mom tomorrow 6pm every week"'
              value={value} onChange={(e) => setValue(e.target.value)}
              autoComplete="off" spellCheck={false} />
            <kbd className="rounded bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-xs text-stone-500">Esc</kbd>
          </div>

          {/* Parsed preview */}
          {parsed && value.trim().length >= 3 && (
            <div className="px-5 py-3 bg-stone-50/80 dark:bg-stone-900/50">
              <div className="flex flex-wrap items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-1">Title</p>
                  <p className="font-medium text-stone-900 dark:text-stone-100">{parsed.title || <em className="text-stone-400">—</em>}</p>
                </div>
                {hasDate && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-1">When</p>
                    <span className="chip border border-brand-300 bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300">
                      📅 {fmt(parsed.date, parsed.time)}
                    </span>
                  </div>
                )}
                {hasRecurrence && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-1">Repeats</p>
                    <span className="chip border border-violet-300 bg-violet-50 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300">
                      ↻ {parsed.recurrence.type.replace(/_/g,' ')}
                    </span>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] text-stone-400">
                Tip: "call mom tomorrow 6pm every week" · "dentist Jan 15 morning" · "gym daily"
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-stone-100 dark:border-stone-800">
            <button type="submit"
              disabled={!parsed?.title || saving}
              className="btn-primary flex-1">
              {saving ? 'Adding…' : '+ Add task'}
            </button>
            <button type="button" className="btn-ghost"
              onClick={() => { onClose(); navigate('/tasks/new'); }}>
              Open full editor ↗
            </button>
          </div>
        </form>

        {/* Hint pills */}
        <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs text-stone-400">
          {['today', 'tomorrow', 'next monday', 'morning', '6pm', 'every week', 'daily'].map((hint) => (
            <button key={hint} type="button"
              className="rounded-full border border-stone-600/30 bg-stone-800/60 px-2.5 py-1 text-stone-300 hover:bg-stone-700/60 transition-colors"
              onClick={() => setValue((v) => v ? `${v} ${hint}` : hint)}>
              {hint}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}