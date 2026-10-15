import { useCallback, useEffect, useRef, useState } from 'react';
import { useToasts } from '../../stores';
import { api } from '../../services/api';
import { Modal } from '../../components/ui';

const WELLNESS_PRESETS = [
  { id: 'water',     icon: '💧', label: 'Drink water',           description: 'Stay hydrated! Keep a glass nearby.',                     color: '#3b82f6', interval: 60 },
  { id: 'posture',   icon: '🪑', label: 'Check posture',         description: 'Sit up straight, relax your shoulders and unclench jaw.', color: '#8b5cf6', interval: 45 },
  { id: 'eye-break', icon: '👁️', label: 'Eye break (20-20-20)', description: 'Look 20 feet away for 20 seconds to rest your eyes.',   color: '#10b981', interval: 20, breakSec: 20 },
  { id: 'stand-up',  icon: '🚶', label: 'Stand up',              description: 'Get up, stretch your legs, and move for a minute.',      color: '#f59e0b', interval: 90 },
];

function formatRem(ms) {
  if (ms <= 0) return 'soon';
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return min > 0 ? `${min}m` : `${sec}s`;
}

const STORE_KEY = 'buddy.wellness.active';
const CHECK_MS = 5000;
function remind(preset, toast) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(`${preset.icon} ${preset.label}`, { body: preset.description }); } catch { /* notifications blocked */ }
  }
  toast(`${preset.icon} ${preset.label} — ${preset.description}`);
  api.buddy.speak(`${preset.icon} ${preset.label}! ${preset.description}`).catch(() => {});
}

const loadActive =() => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } };
const saveActive = (a) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(a)); } catch { /* storage unavailable */ } };

export default function WellnessWidget({ labelClass = '' }) {
  const [open, setOpen] = useState(false);
  // { [presetId]: { nextAt, intervalMin } }, saved so reminders survive reloads.
  const [active, setActive] = useState(loadActive);
  // Running break countdown popup: { preset, endsAt } or null.
  const [breakPopup, setBreakPopup] = useState(null);
  const toast = useToasts((s) => s.push);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Request notification permission once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => { saveActive(active); }, [active]);

  // One clock check every few seconds instead of chained one-shot timers:
  // each due reminder fires and is rescheduled from now, so it keeps repeating
  // and catches up once (not many times) after the PC sleeps. Also refreshes
  // the countdowns.
  const activeRef = useRef(active);
  activeRef.current = active;
  const [, tick] = useState(0);
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const due = Object.entries(activeRef.current).filter(([, r]) => now >= r.nextAt);
      tick((n) => n + 1);
      if (!due.length) return;
      for (const [id] of due) {
        const preset = WELLNESS_PRESETS.find((p) => p.id === id);
        if (!preset) continue;
        remind(preset, toastRef.current);
        if (preset.breakSec) setBreakPopup({ preset, endsAt: now + preset.breakSec * 1000 });
      }
      setActive((a) => {
        const next = { ...a };
        for (const [id] of due) if (next[id]) next[id] = { ...next[id], nextAt: now + next[id].intervalMin * 60_000 };
        return next;
      });
    };
    const t = setInterval(check, CHECK_MS);
    return () => clearInterval(t);
  }, []);

  // Tick the break countdown; close shortly after it reaches zero.
  const [, breakTick] = useState(0);
  useEffect(() => {
    if (!breakPopup) return;
    const t = setInterval(() => {
      breakTick((n) => n + 1);
      if (Date.now() >= breakPopup.endsAt + 1500) setBreakPopup(null);
    }, 250);
    return () => clearInterval(t);
  }, [breakPopup]);

  const toggle = useCallback((id, intervalMin) => {
    setActive((a) => {
      const next = { ...a };
      if (next[id]) delete next[id];
      else next[id] = { nextAt: Date.now() + intervalMin * 60_000, intervalMin };
      return next;
    });
  }, []);

  const enabledCount = Object.keys(active).length;

  return (
    <>
      <button
        type="button"
        id="wellness-toggle"
        onClick={() => setOpen(true)}
        className={`relative flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors md:max-lg:justify-center ${
          open || enabledCount > 0
            ? 'bg-emerald-100/90 text-emerald-950 font-semibold dark:bg-emerald-950/60 dark:text-emerald-300'
            : 'text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100'
        }`}
        title="Wellness reminders">
        <span className="text-base shrink-0" aria-hidden="true">🌿</span>
        <span className={labelClass}>Wellness</span>
        {enabledCount > 0 && (
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white shadow-sm ${
            labelClass ? 'ml-auto md:max-lg:absolute md:max-lg:right-0.5 md:max-lg:top-0.5 md:max-lg:ml-0 md:max-lg:h-4 md:max-lg:w-4 md:max-lg:text-[10px]' : 'ml-auto'
          }`}>
            {enabledCount}
          </span>
        )}
      </button>

      {breakPopup && (() => {
        const { preset, endsAt } = breakPopup;
        const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
        const R = 54, C = 2 * Math.PI * R;
        return (
          <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-72 rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-stone-900">
              <p className="text-lg font-semibold text-stone-900 dark:text-stone-100">{preset.icon} {preset.label}</p>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{preset.description}</p>
              <div className="relative mx-auto my-5 h-32 w-32">
                <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                  <circle cx="60" cy="60" r={R} fill="none" strokeWidth="8" className="stroke-stone-200 dark:stroke-stone-700" />
                  <circle cx="60" cy="60" r={R} fill="none" strokeWidth="8" strokeLinecap="round" stroke={preset.color}
                    strokeDasharray={C} strokeDashoffset={C * (1 - left / preset.breakSec)} style={{ transition: 'stroke-dashoffset 250ms linear' }} />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center font-mono text-4xl font-bold" style={{ color: preset.color }}>
                  {left > 0 ? left : '✓'}
                </span>
              </div>
              <p className="mb-4 text-sm text-stone-600 dark:text-stone-300">{left > 0 ? 'Keep looking away…' : 'Done! Back to work 👍'}</p>
              <button type="button" className="btn-primary px-5" onClick={() => setBreakPopup(null)}>
                {left > 0 ? 'Skip' : 'Close'}
              </button>
            </div>
          </div>
        );
      })()}

      {open && (
        <Modal title="🌿 Wellness Reminders" onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <p className="text-sm text-stone-600 dark:text-stone-300">
              One-click presets for healthy habits while working. Your desktop buddy sits with you and alerts you when it's time to stretch or hydrate.
            </p>

            <div className="grid gap-2.5">
              {WELLNESS_PRESETS.map((p) => {
                const isOn = !!active[p.id];
                const rem = isOn ? formatRem(active[p.id].nextAt - Date.now()) : null;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id, p.interval)}
                    className={`flex items-center gap-3.5 rounded-xl border-2 p-3 text-left transition-all hover:scale-[1.005] active:scale-[.99] ${
                      isOn
                        ? 'shadow-sm'
                        : 'border-stone-200 bg-stone-50/50 hover:border-stone-300 dark:border-stone-700/80 dark:bg-stone-800/30'
                    }`}
                    style={isOn ? { borderColor: p.color, background: `${p.color}15` } : {}}>
                    <span className="text-2xl shrink-0 p-1.5 rounded-xl bg-white dark:bg-stone-800 shadow-sm">
                      {p.icon}
                    </span>
                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{p.label}</p>
                        {isOn && rem && (
                          <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-md shrink-0 bg-white/90 dark:bg-stone-800 shadow-sm" style={{ color: p.color }}>
                            ⏱ in {rem}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{p.description}</p>
                      <span className="inline-block text-[11px] font-medium text-stone-400 mt-1">
                        Every {p.interval < 60 ? `${p.interval} min` : `${p.interval / 60}h`}
                      </span>
                    </div>
                    {/* Toggle Switch */}
                    <div className={`shrink-0 h-6 w-11 rounded-full p-0.5 transition-colors ${isOn ? 'bg-emerald-500' : 'bg-stone-300 dark:bg-stone-700'}`}>
                      <div className={`h-5 w-5 rounded-full bg-white shadow-md transition-transform ${isOn ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-stone-200 dark:border-stone-800">
              <span className="text-xs text-stone-500 dark:text-stone-400">
                {enabledCount > 0
                  ? `🌿 ${enabledCount} active reminder${enabledCount > 1 ? 's' : ''}`
                  : 'No reminders on'}
              </span>
              <button type="button" className="btn-primary px-5" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}