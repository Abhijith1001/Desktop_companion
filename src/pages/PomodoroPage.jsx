import { useCallback, useEffect, useRef, useState } from 'react';
import { BuddyPreview } from '../components/ui';
import { useSettings } from '../stores';
import { api } from '../services/api';

const PRESETS = [
  { label: 'Pomodoro', work: 25, break: 5, icon: '🍅' },
  { label: 'Long focus', work: 50, break: 10, icon: '🧠' },
  { label: 'Short sprint', work: 15, break: 3, icon: '⚡' },
];

const PHASES = {
  idle: { label: 'Ready to focus', buddy: 'idle' },
  work: { label: 'Focus time', buddy: 'sit' },
  break: { label: 'Break time!', buddy: 'stretch' },
  done: { label: 'Session complete!', buddy: 'happy' },
};

function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(secs) { return `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`; }

export default function PomodoroPage() {
  const character = useSettings((s) => s.settings.character);
  const accessory = useSettings((s) => s.settings.accessory);

  const [preset, setPreset] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [seconds, setSeconds] = useState(PRESETS[0].work * 60);
  const [rounds, setRounds] = useState(0);
  const [targetRounds, setTargetRounds] = useState(4);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);
  const audioCtx = useRef(null);

  const p = PRESETS[preset];
  const phaseInfo = PHASES[phase];

  const playBeep = useCallback((freq = 440, dur = 0.3) => {
    try {
      if (!audioCtx.current) audioCtx.current = new AudioContext();
      const ctx = audioCtx.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start(); osc.stop(ctx.currentTime + dur);
    } catch { /* audio not supported */ }
  }, []);

  const startWork = useCallback(() => {
    setPhase('work');
    setSeconds(p.work * 60);
    setRunning(true);
    try { api.buddy.speak("Focus time! I'll sit quietly beside you 🍅"); } catch { /* */ }
  }, [p.work]);

  const startBreak = useCallback(() => {
    setPhase('break');
    setSeconds(p.break * 60);
    setRunning(true);
    playBeep(660, 0.4);
    try { api.buddy.speak("Time for a break! Let's stretch together 🙆"); } catch { /* */ }
  }, [p.break, playBeep]);

  const endSession = useCallback(() => {
    setPhase('done');
    setRunning(false);
    playBeep(880, 0.6);
    clearInterval(intervalRef.current);
    try { api.buddy.speak("Awesome session! You crushed it! 🏆"); } catch { /* */ }
  }, [playBeep]);

  const reset = useCallback(() => {
    clearInterval(intervalRef.current);
    setPhase('idle');
    setSeconds(PRESETS[preset].work * 60);
    setRunning(false);
    setRounds(0);
  }, [preset]);

  useEffect(() => {
    if (!running) { clearInterval(intervalRef.current); return; }
    intervalRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(intervalRef.current);
          if (phase === 'work') {
            const nextRounds = rounds + 1;
            setRounds(nextRounds);
            if (nextRounds >= targetRounds) endSession();
            else startBreak();
          } else if (phase === 'break') {
            startWork();
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [running, phase, rounds, targetRounds, endSession, startBreak, startWork]);

  const pct = phase === 'idle' || phase === 'done' ? 0
    : phase === 'work' ? (1 - seconds / (p.work * 60))
    : (1 - seconds / (p.break * 60));

  const circumference = 2 * Math.PI * 88;
  const dashOffset = circumference * (1 - pct);

  return (
    <div className="flex h-full flex-col items-center justify-start gap-8 overflow-y-auto px-4 py-6 sm:px-6 lg:py-8">
      <header className="text-center">
        <h1 className="page-title">Focus mode</h1>
        <p className="mt-1 text-sm text-stone-500">Work with intention, rest with purpose.</p>
      </header>

      {/* Preset selector */}
      <div className="flex gap-2">
        {PRESETS.map((pr, i) => (
          <button key={i} type="button" disabled={running}
            onClick={() => { setPreset(i); reset(); setSeconds(pr.work * 60); }}
            className={`flex items-center gap-2 rounded-xl border-2 px-4 py-2 text-sm font-semibold transition-all ${
              preset === i
                ? 'border-brand-500 bg-brand-50 text-stone-900 dark:bg-brand-900/30'
                : 'border-stone-200 hover:border-brand-300 dark:border-stone-700'
            }`}>
            <span>{pr.icon}</span> {pr.label}
          </button>
        ))}
      </div>

      {/* Timer circle */}
      <div className="relative flex flex-col items-center gap-4">
        <div className="relative">
          <svg width="200" height="200" className="-rotate-90">
            <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor"
              className="text-stone-100 dark:text-stone-800" strokeWidth="8" />
            <circle cx="100" cy="100" r="88" fill="none"
              stroke={phase === 'break' ? '#34d399' : 'var(--color-brand-500)'}
              strokeWidth="8" strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 1s linear' }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-5xl font-mono font-bold tabular-nums">{fmtTime(seconds)}</span>
            <span className="mt-1 text-xs font-semibold uppercase tracking-widest text-stone-500">
              {phaseInfo.label}
            </span>
          </div>
        </div>

        {/* Buddy sitting quietly beside timer during focus / stretching on break */}
        <div className="flex flex-col items-center transition-all duration-500">
          <BuddyPreview id={character} accessory={accessory}
            state={phaseInfo.buddy}
            size={0.65} />
          {phase === 'work' && (
            <p className="mt-2 text-center text-xs text-stone-500 font-medium">Sitting quietly beside you 🍅</p>
          )}
          {phase === 'break' && (
            <p className="mt-2 text-center text-xs text-emerald-600 dark:text-emerald-400 font-semibold animate-pulse">Stretching with you! 🙆</p>
          )}
          {phase === 'idle' && (
            <p className="mt-2 text-center text-xs text-stone-400">Ready when you are!</p>
          )}
          {phase === 'done' && (
            <p className="mt-2 text-center text-xs text-amber-600 font-semibold">Session complete! 🎉</p>
          )}
        </div>
      </div>

      {/* Rounds indicator */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-stone-500">Rounds:</span>
        <div className="flex gap-1.5">
          {Array.from({ length: targetRounds }, (_, i) => (
            <span key={i}
              className={`h-3 w-3 rounded-full transition-colors ${i < rounds ? 'bg-brand-500' : 'bg-stone-200 dark:bg-stone-700'}`} />
          ))}
        </div>
        <select className="ml-2 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-900"
          value={targetRounds} onChange={(e) => setTargetRounds(Number(e.target.value))} disabled={running}>
          {[2,3,4,6,8].map((n) => <option key={n} value={n}>{n} rounds</option>)}
        </select>
      </div>

      {/* Controls */}
      <div className="flex gap-3">
        {phase === 'idle' && (
          <button type="button" className="btn-primary px-8 py-3 text-base" onClick={startWork}>
            🍅 Start focus
          </button>
        )}
        {(phase === 'work' || phase === 'break') && running && (
          <button type="button" className="btn-outline px-6 py-2.5"
            onClick={() => setRunning(false)}>⏸ Pause</button>
        )}
        {(phase === 'work' || phase === 'break') && !running && (
          <button type="button" className="btn-primary px-6 py-2.5"
            onClick={() => setRunning(true)}>▶ Resume</button>
        )}
        {phase !== 'idle' && (
          <button type="button" className="btn-ghost px-4 py-2.5" onClick={reset}>↺ Reset</button>
        )}
        {phase === 'done' && (
          <button type="button" className="btn-primary px-8 py-3 text-base" onClick={reset}>
            🎉 New session
          </button>
        )}
      </div>

      {/* Summary */}
      {phase === 'done' && (
        <div className="card p-5 text-center">
          <p className="text-xl font-bold">Session complete! 🏆</p>
          <p className="mt-1 text-stone-500">
            You focused for {rounds * p.work} minutes total. Awesome work!
          </p>
        </div>
      )}

      {/* Wellness tips */}
      {phase === 'break' && (
        <div className="card max-w-sm p-4 text-center text-sm text-stone-600 dark:text-stone-300">
          <p className="font-semibold mb-1">Break tip 💡</p>
          <p>{[
            'Look at something 20 feet away for 20 seconds (20-20-20 rule) 👁️',
            'Stand up, roll your shoulders back, and take 3 deep breaths 🧘',
            'Drink a glass of water 💧',
            'Walk around for a minute to get your blood moving 🚶',
            'Close your eyes and rest them for the full break 😌',
          ][rounds % 5]}</p>
        </div>
      )}
    </div>
  );
}