import { useCallback, useEffect, useRef, useState } from 'react';
import { BuddyPreview } from '../components/ui';
import { useSettings } from '../stores';
import { api } from '../services/api';
import Confetti from '../features/progress/Confetti';

const PRESETS = [
  { label: 'Pomodoro', work: 25, break: 5, icon: '🍅' },
  { label: 'Long focus', work: 50, break: 10, icon: '🧠' },
  { label: 'Short sprint', work: 15, break: 3, icon: '⚡' },
  { label: 'Quick demo', work: 1, break: 1, icon: '🧪' },
];

const PHASES = {
  idle: { label: 'Ready to focus', buddy: 'idle' },
  work: { label: 'Focus time', buddy: 'sit' },
  break: { label: 'Break time! Stretch & breathe', buddy: 'stretch' },
  done: { label: 'Session complete! Great job', buddy: 'happy' },
};

function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(secs) { return `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`; }

export default function PomodoroPage() {
  const character = useSettings((s) => s.settings?.character || 'dog');
  const accessory = useSettings((s) => s.settings?.accessory || null);

  const [preset, setPreset] = useState(0);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'work' | 'break' | 'done'
  const [seconds, setSeconds] = useState(PRESETS[0].work * 60);
  const [rounds, setRounds] = useState(0);
  const [targetRounds, setTargetRounds] = useState(4);
  const [running, setRunning] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const audioCtx = useRef(null);

  const p = PRESETS[preset];
  const phaseInfo = PHASES[phase] || PHASES.idle;

  const playBeep = useCallback((freq = 520, dur = 0.35) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtx.current) audioCtx.current = new AudioCtx();
      const ctx = audioCtx.current;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch { /* audio not supported */ }
  }, []);

  const startWork = useCallback(() => {
    setPhase('work');
    setSeconds(p.work * 60);
    setRunning(true);
    playBeep(523, 0.3); // High C
    try { api.buddy?.speak?.("Focus time! I'll sit quietly beside you 🍅")?.catch?.(() => {}); } catch { /* */ }
    try { api.buddy?.sit?.()?.catch?.(() => {}); } catch { /* */ }
  }, [p.work, playBeep]);

  const triggerBreak = useCallback(() => {
    setPhase('break');
    setSeconds(p.break * 60);
    setRunning(true);
    playBeep(659, 0.45); // E
    try { api.buddy?.speak?.("Break time! Time to stretch together 🙆")?.catch?.(() => {}); } catch { /* */ }
    try { api.buddy?.stretch?.()?.catch?.(() => {}); } catch { /* */ }
  }, [p.break, playBeep]);

  const triggerDone = useCallback(() => {
    setPhase('done');
    setRunning(false);
    setSeconds(0);
    setShowConfetti(true);
    playBeep(784, 0.6); // G
    try { api.buddy?.speak?.("Awesome session! You crushed all focus rounds! 🏆")?.catch?.(() => {}); } catch { /* */ }
    try { api.buddy?.celebrate?.("Session complete! 🏆")?.catch?.(() => {}); } catch { /* */ }
  }, [playBeep]);

  const reset = useCallback(() => {
    setPhase('idle');
    setSeconds(PRESETS[preset].work * 60);
    setRunning(false);
    setRounds(0);
    setShowConfetti(false);
  }, [preset]);

  // Main countdown ticker (only decrements numbers, zero side effects)
  useEffect(() => {
    if (!running) return undefined;
    const interval = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  // Clean phase transition when timer reaches 0
  useEffect(() => {
    if (!running || seconds > 0) return;

    if (phase === 'work') {
      const nextRounds = rounds + 1;
      setRounds(nextRounds);
      if (nextRounds >= targetRounds) {
        triggerDone();
      } else {
        triggerBreak();
      }
    } else if (phase === 'break') {
      startWork();
    }
  }, [seconds, running, phase, rounds, targetRounds, triggerDone, triggerBreak, startWork]);

  // Circular progress calculation
  const totalSecs = phase === 'break' ? p.break * 60 : p.work * 60;
  const pct = (phase === 'idle' || phase === 'done')
    ? 0
    : Math.max(0, Math.min(1, 1 - seconds / totalSecs));

  const circumference = 2 * Math.PI * 88;
  const dashOffset = circumference * (1 - pct);

  return (
    <div className="relative flex h-full flex-col items-center justify-start gap-6 overflow-y-auto px-4 py-6 sm:px-6 lg:py-8">
      {showConfetti && <Confetti onComplete={() => setShowConfetti(false)} />}

      <header className="text-center">
        <h1 className="page-title">Focus Mode</h1>
        <p className="mt-1 text-sm text-stone-500">Work with intention, rest with purpose.</p>
      </header>

      {/* Preset selector */}
      <div className="flex flex-wrap justify-center gap-2">
        {PRESETS.map((pr, i) => (
          <button
            key={i}
            type="button"
            disabled={running}
            onClick={() => {
              setPreset(i);
              setPhase('idle');
              setSeconds(pr.work * 60);
              setRunning(false);
            }}
            className={`flex items-center gap-2 rounded-xl border-2 px-3.5 py-2 text-sm font-semibold transition-all ${
              preset === i
                ? 'border-brand-500 bg-brand-50 text-stone-900 dark:bg-brand-900/30 dark:text-stone-100 shadow-sm'
                : 'border-stone-200 hover:border-brand-300 dark:border-stone-700 text-stone-700 dark:text-stone-300'
            } ${running ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <span>{pr.icon}</span>
            <span>{pr.label} ({pr.work}m/{pr.break}m)</span>
          </button>
        ))}
      </div>

      {/* Timer circle + Buddy */}
      <div className="relative flex flex-col items-center gap-4">
        <div className="relative">
          <svg width="220" height="220" className="-rotate-90">
            <circle
              cx="110"
              cy="110"
              r="88"
              fill="none"
              stroke="currentColor"
              className="text-stone-100 dark:text-stone-800"
              strokeWidth="10"
            />
            <circle
              cx="110"
              cy="110"
              r="88"
              fill="none"
              stroke={phase === 'break' ? '#10b981' : 'var(--color-brand-500, #f59e0b)'}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 0.8s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-5xl font-mono font-bold tabular-nums tracking-tight">
              {fmtTime(seconds)}
            </span>
            <span className={`mt-1.5 text-xs font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full ${
              phase === 'work'
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                : phase === 'break'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 animate-pulse'
                : phase === 'done'
                ? 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300'
                : 'text-stone-500'
            }`}>
              {phaseInfo.label}
            </span>
          </div>
        </div>

        {/* Buddy sitting quietly beside timer during focus / stretching on break */}
        <div className="flex flex-col items-center transition-all duration-500 mt-1">
          <BuddyPreview
            id={character}
            accessory={accessory}
            state={phaseInfo.buddy}
            size={0.65}
          />
          {phase === 'work' && (
            <p className="mt-2 text-center text-xs text-stone-500 font-medium bg-stone-100 dark:bg-stone-800/60 px-3 py-1 rounded-full shadow-sm">
              Sitting quietly beside you 🍅
            </p>
          )}
          {phase === 'break' && (
            <p className="mt-2 text-center text-xs text-emerald-700 dark:text-emerald-300 font-semibold bg-emerald-100/70 dark:bg-emerald-950/60 px-3 py-1 rounded-full animate-pulse shadow-sm">
              Stretching with you! 🙆
            </p>
          )}
          {phase === 'idle' && (
            <p className="mt-2 text-center text-xs text-stone-400">
              Ready to focus when you are!
            </p>
          )}
          {phase === 'done' && (
            <p className="mt-2 text-center text-xs text-violet-700 dark:text-violet-300 font-bold bg-violet-100/70 dark:bg-violet-950/60 px-3 py-1 rounded-full shadow-sm">
              Session complete! You crushed it 🎉
            </p>
          )}
        </div>
      </div>

      {/* Rounds indicator */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-stone-500">Rounds:</span>
        <div className="flex gap-1.5">
          {Array.from({ length: targetRounds }, (_, i) => (
            <span
              key={i}
              className={`h-3.5 w-3.5 rounded-full transition-all ${
                i < rounds
                  ? 'bg-brand-500 shadow-sm scale-110'
                  : 'bg-stone-200 dark:bg-stone-700'
              }`}
            />
          ))}
        </div>
        <select
          className="ml-2 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-900"
          value={targetRounds}
          onChange={(e) => setTargetRounds(Number(e.target.value))}
          disabled={running}>
          {[2, 3, 4, 6, 8].map((n) => (
            <option key={n} value={n}>{n} rounds</option>
          ))}
        </select>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {phase === 'idle' && (
          <button type="button" className="btn-primary px-8 py-3 text-base shadow-lg" onClick={startWork}>
            🍅 Start focus
          </button>
        )}

        {(phase === 'work' || phase === 'break') && running && (
          <button type="button" className="btn-outline px-6 py-2.5 font-semibold" onClick={() => setRunning(false)}>
            ⏸ Pause
          </button>
        )}

        {(phase === 'work' || phase === 'break') && !running && (
          <button type="button" className="btn-primary px-6 py-2.5 font-semibold" onClick={() => setRunning(true)}>
            ▶ Resume
          </button>
        )}

        {(phase === 'work' || phase === 'break') && (
          <button
            type="button"
            className="btn-ghost px-4 py-2.5 text-xs font-semibold text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
            onClick={() => {
              if (phase === 'work') {
                const nextRounds = rounds + 1;
                setRounds(nextRounds);
                if (nextRounds >= targetRounds) triggerDone();
                else triggerBreak();
              } else {
                startWork();
              }
            }}>
            ⏭ Skip to {phase === 'work' ? 'break' : 'focus'}
          </button>
        )}

        {phase !== 'idle' && (
          <button type="button" className="btn-ghost px-4 py-2.5 text-stone-500" onClick={reset}>
            ↺ Reset
          </button>
        )}

        {phase === 'done' && (
          <button type="button" className="btn-primary px-8 py-3 text-base" onClick={reset}>
            🎉 New session
          </button>
        )}
      </div>

      {/* Summary card */}
      {phase === 'done' && (
        <div className="card p-5 text-center max-w-md shadow-lg border-2 border-brand-500/40 bg-brand-50/20">
          <p className="text-xl font-bold">Session complete! 🏆</p>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            You completed {rounds} focus round{rounds > 1 ? 's' : ''} ({rounds * p.work} minutes total). Excellent work!
          </p>
        </div>
      )}

      {/* Wellness tips on break */}
      {phase === 'break' && (
        <div className="card max-w-md p-4 text-center text-sm text-stone-600 dark:text-stone-300 shadow-md border-emerald-400/40 border">
          <p className="font-bold text-emerald-800 dark:text-emerald-300 mb-1 flex items-center justify-center gap-1.5">
            <span>💡</span> Break Tip
          </p>
          <p>{[
            'Look at something 20 feet away for 20 seconds (20-20-20 eye rest rule) 👁️',
            'Stand up, roll your shoulders back, and take 3 deep breaths 🧘',
            'Drink a tall glass of fresh water 💧',
            'Walk around for a minute to get your circulation flowing 🚶',
            'Close your eyes and let your mind completely relax 😌',
          ][rounds % 5]}</p>
        </div>
      )}
    </div>
  );
}