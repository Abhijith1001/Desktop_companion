import { useEffect, useRef } from 'react';
import { useToasts } from '../stores';

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, textarea, select, button')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-stone-950/40 p-4 pt-12 backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={`card w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} p-5 shadow-2xl`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" className="btn-ghost px-2" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" onClick={() => dismiss(t.id)}
          className={`pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-left text-sm font-medium shadow-lg ${t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'}`}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <label className={`flex items-start justify-between gap-4 py-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-stone-500 dark:text-stone-400">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={!!checked} disabled={disabled}
          onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-stone-300 transition-colors peer-checked:bg-brand-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/50 dark:bg-stone-700" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function Field({ label, htmlFor, children, hint }) {
  return (
    <div>
      {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{hint}</p>}
    </div>
  );
}

export function Section({ title, description, children }) {
  return (
    <section className="card p-5">
      <h2 className="text-base font-bold">{title}</h2>
      {description && <p className="mb-2 text-sm text-stone-500 dark:text-stone-400">{description}</p>}
      <div className="mt-2 divide-y divide-stone-100 dark:divide-stone-800">{children}</div>
    </section>
  );
}

const PRIORITY_STYLES = {
  HIGH: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  MEDIUM: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  LOW: 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
};

export function PriorityChip({ priority }) {
  return <span className={`chip ${PRIORITY_STYLES[priority]}`}>{priority.toLowerCase()}</span>;
}

// Renders a character using the shared markup and animation CSS.
export function BuddyPreview({ id, state = 'idle', size = 1, className = '' }) {
  const c = window.CHARACTERS[id] || window.CHARACTERS.dog;
  return (
    <div className={`buddy ${state} ${c.upright ? 'upright' : ''} ${className}`}
      style={{ width: 160 * size, height: 130 * size }}
      // Markup is our own static SVG from characters.js, never user input.
      dangerouslySetInnerHTML={{ __html: window.buddyMarkup(id) }} />
  );
}
