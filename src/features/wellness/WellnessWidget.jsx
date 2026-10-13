import { useCallback, useEffect, useRef, useState } from 'react';
import { useToasts } from '../../stores';
import { api } from '../../services/api';

const WELLNESS_PRESETS = [
  { id: 'water',     icon: '💧', label: 'Drink water',           description: 'Stay hydrated!',                          color: '#3b82f6', interval: 60 },
  { id: 'posture',   icon: '🪑', label: 'Check posture',         description: 'Sit up straight, relax your shoulders.',   color: '#8b5cf6', interval: 45 },
  { id: 'eye-break', icon: '👁️', label: 'Eye break (20-20-20)', description: 'Look 20 feet away for 20 seconds.',        color: '#10b981', interval: 20 },
  { id: 'stand-up',  icon: '🚶', label: 'Stand up',              description: 'Get up and move for a minute.',           color: '#f59e0b', interval: 90 },
];

function formatRem(ms) {
  if (ms <= 0) return 'soon';
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return min > 0 ? `${min}m` : `${sec}s`;
}

export default function WellnessWidget() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState({});
  const [, tick] = useState(0);
  const timers = useRef({});
  const toast = useToasts((s) => s.push);

  // Request notification permission once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Tick every 5s to refresh countdowns
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => Object.values(timers.current).forEach(clearTimeout);
  }, []);

  const schedule = useCallback((id, intervalMin) => {
    clearTimeout(timers.current[id]);
    const nextAt = Date.now() + intervalMin * 60_000;
    setActive((a) => ({ ...a, [id]: { nextAt, intervalMin } }));
    timers.current[id] = setTimeout(() => {
      const preset = WELLNESS_PRESETS.find((p) => p.id === id);
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification(`${preset.icon} ${preset.label}`, { body: preset.description }); } catch { /* */ }
      }
      toast(`${preset.icon} ${preset.label} — ${preset.description}`);
      try { api.buddy.speak(`${preset.icon} ${preset.label}! ${preset.description}`); } catch { /* */ }
      // Auto-reschedule
      schedule(id, intervalMin);
    }, intervalMin * 60_000);
  }, [toast]);

  const toggle = useCallback((id, intervalMin) => {
    setActive((a) => {
      if (a[id]) {
        clearTimeout(timers.current[id]);
        const next = { ...a }; delete next[id]; return next;
      }
      // Will schedule after state update via effect
      return a;
    });
    setActive((a) => {
      if (!a[id]) {
        // Not active — enable it
        clearTimeout(timers.current[id]);
        const nextAt = Date.now() + intervalMin * 60_000;
        timers.current[id] = setTimeout(() => {
          const preset = WELLNESS_PRESETS.find((p) => p.id === id);
          if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification(`${preset.icon} ${preset.label}`, { body: preset.description }); } catch { /* */ }
          }
          toast(`${preset.icon} ${preset.label} — ${preset.description}`);
          try { api.buddy.speak(`${preset.icon} ${preset.label}! ${preset.description}`); } catch { /* */ }
          schedule(id, intervalMin);
        }, intervalMin * 60_000);
        return { ...a, [id]: { nextAt, intervalMin } };
      }
      return a;
    });
  }, [schedule, toast]);

  const enabledCount = Object.keys(active).length;

  return (
    <div className="relative">
      <button type="button" id="wellness-toggle"
        onClick={() => setOpen((o) => !o)}
        className={`relative flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-all ${
          open || enabledCount > 0
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
            : 'text-stone-600 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800'
        }`}
        title="Wellness reminders">
        <span aria-hidden="true">🌿</span>
        <span>Wellness</span>
        {enabledCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
            {enabledCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-72 card p-4 shadow-2xl z-30">
          <h3 className="mb-3 text-sm font-bold flex items-center gap-2">🌿 Wellness Reminders</h3>
          <div className="grid gap-2">
            {WELLNESS_PRESETS.map((p) => {
              const isOn = !!active[p.id];
              const rem = isOn ? formatRem(active[p.id].nextAt - Date.now()) : null;
              return (
                <button key={p.id} type="button"
                  onClick={() => toggle(p.id, p.interval)}
                  className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all hover:scale-[1.01] active:scale-[.99] ${
                    isOn ? '' : 'border-stone-200 dark:border-stone-700'
                  }`}
                  style={isOn ? { borderColor: p.color, background: `${p.color}18` } : {}}>
                  <span className="text-2xl shrink-0">{p.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{p.label}</p>
                      {isOn && rem && (
                        <span className="text-[11px] font-mono shrink-0" style={{ color: p.color }}>⏱ {rem}</span>
                      )}
                    </div>
                    <p className="text-xs text-stone-500">{p.description}</p>
                    <p className="text-[11px] text-stone-400 mt-0.5">
                      Every {p.interval < 60 ? `${p.interval} min` : `${p.interval / 60}h`}
                    </p>
                  </div>
                  <div className={`shrink-0 h-5 w-9 rounded-full transition-colors ${isOn ? 'bg-emerald-500' : 'bg-stone-200 dark:bg-stone-700'}`}>
                    <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${isOn ? 'translate-x-4' : 'translate-x-0'}`} />
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-stone-400 text-center">
            Reminders fire even if this panel is closed
          </p>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
      )}
    </div>
  );
}