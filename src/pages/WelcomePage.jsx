import { useEffect, useRef, useState } from 'react';
import { useSettings, useTasks, useToasts } from '../stores';
import { api } from '../services/api';
import { navigate } from '../hooks/useRoute';
import { BuddyPreview, Toggle } from '../components/ui';

// First-run welcome: the buddy (on the desktop) talks the user through each
// step while this page collects the choices. Every step can be skipped.
const STEPS = ['hello', 'character', 'name', 'task', 'tray', 'toggle', 'drag', 'menu', 'done'];
const TOUR = { tray: null, toggle: 'toggled', drag: 'dragged', menu: 'menu' }; // step → event that completes it

const NAME_IDEAS = ['Biscuit', 'Pixel', 'Mochi', 'Captain', 'Nugget', 'Ziggy'];

const cue = (c, text, ms) => api.onboarding.cue({ cue: c, text, ms }).catch(() => {});

function quickTimes() {
  const now = new Date();
  const at = (h, m, addDays = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + addDays);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const inMin = (m) => new Date(now.getTime() + m * 60_000);
  const evening = at(20, 0);
  return [
    { label: 'In 15 minutes', at: inMin(15) },
    { label: 'In 1 hour', at: inMin(60) },
    evening > now ? { label: 'Tonight, 8 PM', at: evening } : { label: 'Tomorrow, 8 PM', at: at(20, 0, 1) },
    { label: 'Tomorrow, 9 AM', at: at(9, 0, 1) },
  ];
}

const fmt = (d) => d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export default function WelcomePage() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(settings.buddyName || '');
  const [taskTitle, setTaskTitle] = useState('');
  const [timeIdx, setTimeIdx] = useState(1);
  const [times] = useState(quickTimes);
  const [done, setDone] = useState({});
  const [startup, setStartup] = useState(true);
  const [busy, setBusy] = useState(false);
  const replay = useRef(settings.onboarded);
  const id = STEPS[step];
  const buddyName = name.trim() || 'your buddy';

  const go = (n) => setStep((s) => Math.max(0, Math.min(STEPS.length - 1, n ?? s + 1)));

  // Replays (from Settings) start with a fresh hello; on first run the buddy
  // has just walked in and introduced itself.
  useEffect(() => {
    if (replay.current) cue('wave', "Hi again! 👋 Let's take the tour.");
  }, []);

  // What the buddy says (and where it walks) on each step.
  useEffect(() => {
    const n = name.trim();
    if (id === 'character') cue('say', 'First, pick how I look. Click any of us — I change right away!');
    if (id === 'name') cue('say', 'Now give me a name. Something fun!');
    if (id === 'task') cue('wave', `${n ? `${n}? I love it! ` : ''}What should I remind you about first?`, 5000);
    if (id === 'tray') cue('tray', 'See the paw icon down here in the tray? Click it to open your tasks anytime.', 6000);
    if (id === 'toggle') cue('home', 'Press Ctrl + Alt + B to hide me — and press it again to bring me back.', 6000);
    if (id === 'drag') cue('say', 'You can grab me with the mouse and drop me anywhere. Try it!', 6000);
    if (id === 'menu') cue('say', 'Right-click me for a quick menu with pause, sleep and more.', 6000);
    if (id === 'done') cue('wave', 'You did it! One last thing…');
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tutorial steps tick off when the user actually tries them.
  useEffect(() => api.onboarding.onEvent((evt) => {
    setDone((d) => (d[evt] ? d : { ...d, [evt]: true }));
  }), []);
  useEffect(() => {
    const evt = TOUR[id];
    if (!evt || !done[evt]) return undefined;
    const t = setTimeout(() => go(), 1200);
    if (evt === 'toggled') cue('show', 'Peekaboo! 😄');
    else if (evt === 'dragged') cue('say', 'Wheee! Nice throw.', 2500);
    return () => clearTimeout(t);
  }, [id, done]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickCharacter(cid) {
    update({ character: cid });
    cue('wave', 'Ooh, I like this look!', 2500);
  }

  async function saveName() {
    const n = name.trim();
    await update({ buddyName: n });
    go();
  }

  async function saveTask() {
    const title = taskTitle.trim();
    if (!title) return go();
    setBusy(true);
    try {
      const when = times[timeIdx].at;
      await useTasks.getState().run(() => api.tasks.create({
        title, priority: 'MEDIUM', timeZone: settings.timeZone, dueAt: when.toISOString(), recurrence: null,
      }));
      cue('wave', `Got it! I'll remind you ${times[timeIdx].label.toLowerCase()}.`, 3500);
      go();
    } catch { /* toast already shown */ } finally { setBusy(false); }
  }

  async function finish({ skipped = false } = {}) {
    setBusy(true);
    try {
      const all = await api.onboarding.finish({ startWithWindows: skipped ? settings.startWithWindows : startup });
      useSettings.getState().receive(all);
      if (!skipped) useToasts.getState().push('Welcome aboard! 🐾');
      navigate('/tasks');
    } catch (err) {
      useToasts.getState().push(err.message, 'error');
    } finally { setBusy(false); }
  }

  const ids = Object.keys(window.CHARACTERS);

  return (
    <div className="welcome flex h-full items-center justify-center overflow-y-auto bg-gradient-to-br from-brand-50 via-white to-brand-100 p-6 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      <div className="w-full max-w-xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800" role="progressbar"
            aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Setup progress">
            <div className="h-full rounded-full bg-brand-500 transition-[width] duration-500 ease-out" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
          {id !== 'done' && (
            <button type="button" className="text-xs font-semibold text-stone-500 hover:text-stone-800 dark:hover:text-stone-200" onClick={() => finish({ skipped: true })}>
              Skip setup
            </button>
          )}
        </div>

        <div key={id} className="card welcome-step p-7 shadow-xl shadow-brand-900/5">
          {id === 'hello' && (
            <Step center title="Hi! I'm your Desktop Buddy 👋"
              body="I live on your desktop, keep an eye on your tasks and walk over to remind you when something's due. Let's get you set up — it takes about a minute.">
              <div className="my-5 flex justify-center"><BuddyPreview id={settings.character} state="wave" size={1.1} /></div>
              <button type="button" className="btn-primary px-6 py-2.5 text-base" autoFocus onClick={() => go()}>Let's go!</button>
            </Step>
          )}

          {id === 'character' && (
            <Step title="Pick your buddy" body="You can change this later in Characters.">
              <div className="mt-4 grid grid-cols-3 gap-2">
                {ids.map((cid) => (
                  <button key={cid} type="button" onClick={() => pickCharacter(cid)}
                    className={`flex flex-col items-center rounded-xl border-2 p-2 transition ${settings.character === cid ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-transparent hover:bg-stone-100 dark:hover:bg-stone-800'}`}
                    aria-pressed={settings.character === cid}>
                    <BuddyPreview id={cid} state={settings.character === cid ? 'happy' : 'idle'} size={0.6} />
                    <span className="mt-1 text-xs font-semibold">{window.CHARACTERS[cid].name}</span>
                  </button>
                ))}
              </div>
              <Nav onBack={() => go(step - 1)} onNext={() => go()} />
            </Step>
          )}

          {id === 'name' && (
            <Step title="What should I be called?" body="Your buddy will answer to this name.">
              <form onSubmit={(e) => { e.preventDefault(); saveName(); }}>
                <div className="mt-4 flex items-center gap-4">
                  <BuddyPreview id={settings.character} state="speak" size={0.7} />
                  <input className="input text-lg" autoFocus maxLength={24} placeholder={window.CHARACTERS[settings.character]?.name}
                    value={name} onChange={(e) => setName(e.target.value)} aria-label="Buddy name" />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {NAME_IDEAS.map((n) => (
                    <button key={n} type="button" className="chip bg-stone-100 hover:bg-brand-100 dark:bg-stone-800" onClick={() => setName(n)}>{n}</button>
                  ))}
                </div>
                <Nav onBack={() => go(step - 1)} nextLabel={name.trim() ? 'Next' : 'Skip'} submit />
              </form>
            </Step>
          )}

          {id === 'task' && (
            <Step title="Your first reminder" body={`Add one thing ${name.trim() || 'I'} should remind you about. I've also added a few sample tasks (like “Drink water 💧”) — edit or delete them any time.`}>
              <form onSubmit={(e) => { e.preventDefault(); saveTask(); }}>
                <input className="input mt-4 text-base" autoFocus maxLength={200} placeholder="e.g. Call mom, Submit report…"
                  value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} aria-label="Task title" />
                <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="When">
                  {times.map((t, i) => (
                    <button key={t.label} type="button" role="radio" aria-checked={timeIdx === i} onClick={() => setTimeIdx(i)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${timeIdx === i ? 'border-brand-500 bg-brand-50 font-semibold dark:bg-brand-900/20' : 'border-stone-200 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800'}`}>
                      {t.label}
                      <span className="block text-xs font-normal text-stone-500">{fmt(t.at)}</span>
                    </button>
                  ))}
                </div>
                <Nav onBack={() => go(step - 1)} nextLabel={taskTitle.trim() ? 'Add task' : 'Skip'} busy={busy} submit />
              </form>
            </Step>
          )}

          {id === 'tray' && (
            <Tour n={1} title="Find me in the tray" body="Look at the bottom-right of your screen — the paw icon is me. Click it to open your tasks; right-click it for quick options. (It may be under the ^ arrow.)"
              visual={<TrayArt />} onBack={() => go(step - 1)} onNext={() => go()} />
          )}
          {id === 'toggle' && (
            <Tour n={2} title="Hide and show me" body="Press the shortcut once to hide me, and again to bring me back."
              visual={<Keys keys={['Ctrl', 'Alt', 'B']} />} tried={done.toggled} tryLabel="Try it now" onBack={() => go(step - 1)} onNext={() => go()} />
          )}
          {id === 'drag' && (
            <Tour n={3} title="Move me around" body={`Click and drag ${buddyName} anywhere on the screen. Let go and I'll land on the taskbar.`}
              visual={<span className="text-5xl" aria-hidden>🖱️</span>} tried={done.dragged} tryLabel="Try dragging me" onBack={() => go(step - 1)} onNext={() => go()} />
          )}
          {id === 'menu' && (
            <Tour n={4} title="Right-click for more" body="Right-click me for a quick menu: add a task, pause reminders, change character or put me to sleep."
              visual={<MenuArt />} tried={done.menu} tryLabel="Try right-clicking me" onBack={() => go(step - 1)} onNext={() => go()} />
          )}

          {id === 'done' && (
            <Step center title="You're all set! 🎉" body={`${name.trim() || 'Your buddy'} will keep you on track. Double-click me any time to open your tasks.`}>
              <div className="my-4 flex justify-center"><BuddyPreview id={settings.character} state="happy" size={0.9} /></div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-left dark:border-stone-700 dark:bg-stone-800/60">
                <Toggle label="Start with Windows" checked={startup} onChange={setStartup}
                  description="Recommended. Reminders only work while Desktop Buddy is running, so it starts quietly in the tray when you sign in. You can turn this off any time in Settings." />
              </div>
              <button type="button" className="btn-primary mt-5 px-6 py-2.5 text-base" autoFocus disabled={busy} onClick={() => finish()}>
                Start using Desktop Buddy
              </button>
            </Step>
          )}
        </div>

        <p className="mt-3 text-center text-xs text-stone-500">Step {step + 1} of {STEPS.length}</p>
      </div>
    </div>
  );
}

function Step({ eyebrow, title, body, center, children }) {
  return (
    <div className={center ? 'text-center' : ''}>
      {eyebrow && <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-brand-600">{eyebrow}</p>}
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {body && <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">{body}</p>}
      {children}
    </div>
  );
}

function Nav({ onBack, onNext, nextLabel = 'Next', busy, submit }) {
  return (
    <div className="mt-6 flex items-center justify-between">
      <button type="button" className="btn-ghost" onClick={onBack}>Back</button>
      <button type={submit ? 'submit' : 'button'} className="btn-primary px-5" disabled={busy} onClick={submit ? undefined : onNext}>{nextLabel}</button>
    </div>
  );
}

function Tour({ n, title, body, visual, tried, tryLabel, onBack, onNext }) {
  return (
    <Step eyebrow={`Quick tour · ${n} of 4`} title={title} body={body}>
      <div className="mt-5 flex min-h-28 items-center justify-center rounded-xl bg-stone-50 p-4 dark:bg-stone-800/60">{visual}</div>
      {tryLabel && (
        <p className={`mt-3 text-center text-sm font-semibold ${tried ? 'text-emerald-600' : 'text-stone-500'}`} aria-live="polite">
          {tried ? '✓ Nice — you got it!' : `👉 ${tryLabel}`}
        </p>
      )}
      <Nav onBack={onBack} onNext={onNext} nextLabel={tried || !tryLabel ? 'Next' : 'Skip'} />
    </Step>
  );
}

function Keys({ keys }) {
  return (
    <div className="flex items-center gap-2">
      {keys.map((k, i) => (
        <span key={k} className="flex items-center gap-2">
          {i > 0 && <span className="text-stone-400">+</span>}
          <kbd className="rounded-lg border-b-4 border-stone-300 bg-white px-3 py-2 text-lg font-bold shadow-sm dark:border-stone-600 dark:bg-stone-900">{k}</kbd>
        </span>
      ))}
    </div>
  );
}

function TrayArt() {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-stone-800 px-4 py-2 text-xs text-stone-300">
      <span>^</span><span>📶</span><span>🔊</span>
      <span className="relative grid h-7 w-7 place-items-center rounded-md bg-brand-500 text-sm ring-2 ring-brand-300 animate-pulse">🐾</span>
      <span>10:30</span>
    </div>
  );
}

function MenuArt() {
  return (
    <div className="w-48 rounded-lg border border-stone-200 bg-white py-1 text-left text-xs shadow-lg dark:border-stone-700 dark:bg-stone-900">
      {['Add a task…', 'Pause reminders  ›', 'Character  ›', 'Put buddy to sleep', 'Settings…'].map((l) => (
        <div key={l} className="px-3 py-1 hover:bg-stone-100 dark:hover:bg-stone-800">{l}</div>
      ))}
    </div>
  );
}
