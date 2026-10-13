import { useState } from 'react';

// "Control+Shift+B" -> "Ctrl + Shift + B"
export const shortcutLabel = (acc) => String(acc || '').replace(/Control/g, 'Ctrl').replace(/Super/g, 'Win').split('+').join(' + ');

const NAMED = { Space: 'Space', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };

// KeyboardEvent -> Electron accelerator, or null while only modifiers are held.
function toAccelerator(e) {
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else if (NAMED[e.code]) key = NAMED[e.code];
  if (!key) return null;
  return [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super', key].filter(Boolean).join('+');
}

// Click, then press the new combination. Esc cancels.
export default function ShortcutInput({ id, value, onChange, status }) {
  const [recording, setRecording] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button id={id} type="button"
        className={`input w-auto min-w-44 text-left font-semibold ${recording ? 'border-brand-500 ring-2 ring-brand-500/30' : ''}`}
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (!recording) return;
          e.preventDefault();
          if (e.key === 'Escape') { setRecording(false); return; }
          const acc = toAccelerator(e);
          if (acc) { setRecording(false); if (acc !== value) onChange(acc); }
        }}
        aria-label={recording ? 'Press the new shortcut, or Escape to cancel' : `Shortcut ${shortcutLabel(value)}. Click to change`}>
        {recording ? 'Press keys…' : shortcutLabel(value)}
      </button>
      {status && (status.registered
        ? <span className="text-xs text-green-700 dark:text-green-400">✓ Active</span>
        : <span className="text-xs text-red-600 dark:text-red-400">⚠ In use by another app — choose a different shortcut</span>)}
    </div>
  );
}
