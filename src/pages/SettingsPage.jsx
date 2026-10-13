import { useEffect, useMemo, useState } from 'react';
import { useSettings, useToasts } from '../stores';
import { api } from '../services/api';
import { Section, Toggle, Field } from '../components/ui';
import { navigate } from '../hooks/useRoute';
import { allTimeZones } from '../utils/dates';
import ShortcutInput from '../features/capture/ShortcutInput';
import { ACCENTS, resolveAccent } from '../utils/accent';

const UPDATE_TEXT = {
  idle: 'Not checked yet',
  checking: 'Checking…',
  latest: 'You have the latest version',
  available: (u) => `Version ${u.version} is available`,
  downloading: (u) => `Downloading ${u.version || 'update'}… ${u.progress ?? 0}%`,
  ready: (u) => `Version ${u.version} is ready — restart to install`,
  error: (u) => `Update check failed: ${u.error}`,
  unsupported: 'Updates work in the installed app only',
  store: 'Updates come from the Microsoft Store',
};

const THEMES = [
  { id: 'system', label: 'Match Windows', icon: '🖥️' },
  { id: 'light', label: 'Light', icon: '☀️' },
  { id: 'dark', label: 'Dark', icon: '🌙' },
];

function AppearanceSection({ s, update }) {
  const matched = resolveAccent('character', s.character);
  const swatches = [{ id: 'character', name: `Match my buddy (${ACCENTS[matched].name})`, color: ACCENTS[matched].scale[5] },
    ...Object.entries(ACCENTS).map(([id, a]) => ({ id, name: a.name, color: a.scale[5] }))];
  return (
    <Section title="Appearance" description="Make the app yours: colours follow your buddy unless you pick one.">
      <div className="py-3">
        <span className="label">Theme</span>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={s.theme === t.id} onClick={() => update({ theme: t.id })}
              className={`flex flex-col items-center gap-1 rounded-xl border-2 px-3 py-2.5 text-sm font-medium transition-colors ${s.theme === t.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-stone-200 hover:border-stone-300 dark:border-stone-700 dark:hover:border-stone-600'}`}>
              <span className="text-xl" aria-hidden="true">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="py-3">
        <span className="label">Accent colour</span>
        <div className="flex flex-wrap items-center gap-2.5" role="radiogroup" aria-label="Accent colour">
          {swatches.map((w) => (
            <button key={w.id} type="button" role="radio" aria-checked={s.accent === w.id} title={w.name} aria-label={w.name}
              className="swatch" style={{ background: w.color }} onClick={() => update({ accent: w.id })}>
              {w.id === 'character' ? '🐾' : s.accent === w.id ? '✓' : ''}
            </button>
          ))}
        </div>
      </div>
      <Toggle label="Progress sign" description="Your buddy holds a little sign showing how many tasks are left today"
        checked={s.progressSign} onChange={(v) => update({ progressSign: v })} />
    </Section>
  );
}

function UpdatesSection({ s, update }) {
  const [u, setU] = useState(null);
  useEffect(() => { api.updates.status().then(setU).catch(() => {}); return api.updates.onStatus(setU); }, []);
  const text = u && (typeof UPDATE_TEXT[u.state] === 'function' ? UPDATE_TEXT[u.state](u) : UPDATE_TEXT[u.state]);
  const busy = !u || ['checking', 'downloading', 'unsupported', 'store'].includes(u.state);
  return (
    <Section title="Updates" description={u ? `You're on version ${u.current}.` : undefined}>
      <div className="py-3">
        <Field label="When a new version is out" htmlFor="upd-mode">
          <select id="upd-mode" className="input w-auto" value={s.updates.mode} onChange={(e) => update({ updates: { mode: e.target.value } })}>
            <option value="auto">Update automatically (installs when you quit or restart)</option>
            <option value="ask">Ask me before downloading</option>
          </select>
        </Field>
      </div>
      <div className="flex items-center justify-between gap-4 py-3">
        <span className="text-sm text-stone-600 dark:text-stone-300" aria-live="polite">{text}</span>
        <span className="flex shrink-0 gap-2">
          {u?.state === 'available' && <button type="button" className="btn-primary" onClick={() => api.updates.download()}>Download</button>}
          {u?.state === 'ready'
            ? <button type="button" className="btn-primary" onClick={() => api.updates.install()}>Restart & update</button>
            : <button type="button" className="btn-outline" disabled={busy} onClick={() => api.updates.check()}>Check for updates</button>}
        </span>
      </div>
    </Section>
  );
}

function CaptureSection({ s, update }) {
  const [status, setStatus] = useState(null);
  useEffect(() => { api.capture.status().then(setStatus).catch(() => {}); return api.capture.onStatus(setStatus); }, []);
  const c = s.capture;
  const set = (patch) => update({ capture: patch });
  return (
    <Section title="Text capture" description="Save text from other apps as bookmarks. Capture only happens when you press a shortcut or drop text — nothing is watched in the background.">
      {status && !status.platformSupported && <p className="py-2 text-sm text-red-600">Capturing from other apps is only supported on Windows. Drag-and-drop still works.</p>}
      <div className="py-3">
        <Field label="Capture selected text" htmlFor="cap-sc" hint="Works system-wide. Note: Ctrl+Shift+B also toggles the bookmarks bar in Chrome and Edge; while Desktop Buddy runs, it captures instead.">
          <ShortcutInput id="cap-sc" value={c.shortcut} onChange={(v) => set({ shortcut: v })} status={status?.shortcuts?.capture} />
        </Field>
      </div>
      <Toggle label="Use the clipboard when needed"
        description="Some apps (many browsers, PDF readers) don’t share their selection directly. Desktop Buddy then copies it with Ctrl+C and puts your previous clipboard back straight away. It is skipped if your clipboard holds something it can’t restore, like copied files."
        checked={c.clipboardFallback} onChange={(v) => set({ clipboardFallback: v })} />
      <div className="py-3">
        <Toggle label="Allow screen reading (OCR)"
          description="Lets a separate shortcut read the visible text of the active window once, using Windows’ built-in OCR on this computer. The screenshot is never saved or sent anywhere, and the buddy announces every read."
          checked={c.ocrEnabled} onChange={(v) => set({ ocrEnabled: v })} />
        {c.ocrEnabled && (
          <div className="mt-2">
            <Field label="Read active window" htmlFor="ocr-sc">
              <ShortcutInput id="ocr-sc" value={c.ocrShortcut} onChange={(v) => set({ ocrShortcut: v })} status={status?.shortcuts?.ocr} />
            </Field>
          </div>
        )}
      </div>
    </Section>
  );
}

function AiSection() {
  const toast = useToasts((x) => x.push);
  const [ai, setAi] = useState(null);
  const [key, setKey] = useState('');
  useEffect(() => { api.ai.status().then(setAi).catch(() => {}); }, []);
  const save = async (value) => {
    try { setAi(await api.ai.setKey(value)); setKey(''); toast(value ? 'API key saved' : 'API key removed'); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <Section title="AI assistant (optional)" description="Ask questions about captured text in the chat. Bookmarks work fully without this.">
      <p className="py-2 text-sm">
        {ai?.configured ? <>✓ Connected to {ai.provider} ({ai.model}). You’ll be asked before any message is sent.</> : 'Not set up — the chat searches your bookmarks instead.'}
      </p>
      <form className="flex items-end gap-2 py-3" onSubmit={(e) => { e.preventDefault(); if (key.trim()) save(key.trim()); }}>
        <Field label="Anthropic API key" htmlFor="ai-key" hint="Stored encrypted with Windows’ credential protection. Never shown again.">
          <input id="ai-key" type="password" autoComplete="off" className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder={ai?.configured ? '••••••••  (saved)' : 'sk-ant-…'} />
        </Field>
        <button type="submit" className="btn-primary" disabled={!key.trim()}>Save</button>
        {ai?.configured && <button type="button" className="btn-outline" onClick={() => save(null)}>Remove</button>}
      </form>
    </Section>
  );
}

function WeatherSection({ s, update }) {
  const toast = useToasts((x) => x.push);
  const w = s.weather;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(null);
  useEffect(() => { api.weather.current().then(setNow).catch(() => {}); return api.weather.onUpdate(setNow); }, []);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const choose = (location) => { update({ weather: { location } }); setResults(null); setQuery(''); toast(`Weather set to ${location.name}`); };

  return (
    <Section title="Weather" description="Your buddy shows rain, snow, fog or sunshine based on the weather where you are. Only the location you pick is sent to Open-Meteo (and to OpenStreetMap when searching for small places), both free with no account.">
      <Toggle label="Show local weather" checked={w.enabled} onChange={(v) => update({ weather: { enabled: v } })} />
      {w.enabled && (
        <>
          <p className="py-2 text-sm">
            {w.location
              ? <>📍 <strong>{w.location.name}</strong>{w.location.country ? `, ${w.location.country}` : ''}{now ? ` · ${now.emoji} ${now.temp}°${now.unit}, ${now.description}` : ''}</>
              : 'No location yet — search for your city or use your approximate location.'}
          </p>
          <form className="flex flex-wrap items-end gap-2 py-2" onSubmit={(e) => { e.preventDefault(); run(async () => setResults(await api.weather.search(query))); }}>
            <Field label="City" htmlFor="wx-city">
              <input id="wx-city" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Bengaluru" autoComplete="off" />
            </Field>
            <button type="submit" className="btn-primary" disabled={busy || query.trim().length < 2}>Search</button>
            <button type="button" className="btn-outline" disabled={busy}
              title="Uses your internet address to estimate your city"
              onClick={() => run(async () => choose(await api.weather.locate()))}>📍 Use my location</button>
            <select aria-label="Temperature unit" className="input w-auto" value={w.unit} onChange={(e) => update({ weather: { unit: e.target.value } })}>
              <option value="C">°C</option><option value="F">°F</option>
            </select>
          </form>
          {results && (
            <ul className="py-1 text-sm">
              {results.length === 0 && <li className="text-stone-500">No places found.</li>}
              {results.map((r) => (
                <li key={`${r.lat},${r.lon}`}>
                  <button type="button" className="btn-ghost text-left" onClick={() => choose(r)}>{r.name}{r.country ? `, ${r.country}` : ''}</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

function BuddyCareSection({ s, update }) {
  const toast = useToasts((x) => x.push);
  const [stats, setStats] = useState(null);
  useEffect(() => { api.buddy.stats().then(setStats).catch(() => {}); return api.buddy.onStats(setStats); }, []);
  const feed = async () => {
    try {
      const r = await api.buddy.feed();
      setStats(r);
      if (!r.ok) toast('No treats yet — complete a task to earn one!');
    } catch (err) { toast(err.message, 'error'); }
  };
  const moodText = { happy: '😊 Happy', ok: '🙂 Content', sulky: '😤 Sulking' };
  return (
    <Section title="Buddy" description="Complete tasks to earn treats. Your buddy is happiest when tasks get done, and sulks a little while some are overdue.">
      {stats && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3 text-sm">
          <span>Mood: <strong>{moodText[stats.level]}</strong></span>
          <span>Fullness: <strong>{stats.fullness}%</strong>{stats.hungry ? ' (hungry!)' : ''}</span>
          <span>Treats: <strong>🍪 {stats.treats}</strong></span>
          {stats.overdue > 0 && <span className="text-red-600">{stats.overdue} overdue</span>}
          <button type="button" className="btn-primary ml-auto" disabled={!stats.treats} onClick={feed}>Feed a treat</button>
        </div>
      )}
      <Toggle label="Watch and chase the cursor" description="Looks at the mouse when it's close and sometimes runs after it"
        checked={s.followCursor} onChange={(v) => update({ followCursor: v })} />
      <Toggle label="Sit on top of windows" description="Now and then jumps up onto the active window and sits on its edge"
        checked={s.perchOnWindows} onChange={(v) => update({ perchOnWindows: v })} />
    </Section>
  );
}

function useVoices() {
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  return voices;
}

export default function SettingsPage() {
  const { settings: s, update } = useSettings();
  const toast = useToasts((x) => x.push);
  const zones = useMemo(allTimeZones, []);
  const voices = useVoices();
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState(null);
  useEffect(() => { api.app.info().then(setInfo); api.reminders.status().then(setStatus); }, [s.pausedUntil]);

  const paused = s.pausedUntil && Date.parse(s.pausedUntil) > Date.now();
  const testVoice = () => {
    try {
      const u = new SpeechSynthesisUtterance('Hi! This is how I will read your reminders.');
      const v = voices.find((x) => x.name === s.voice);
      if (v) u.voice = v;
      u.volume = s.volume;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { toast('Speech is not available on this system', 'error'); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <h1 className="page-title">Settings</h1>

      <BuddyCareSection s={s} update={update} />
      <WeatherSection s={s} update={update} />

      <Section title="Reminders">
        <div className="flex flex-wrap items-center gap-2 py-3">
          <span className="text-sm font-medium">{paused ? `Paused until ${new Date(s.pausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Reminders are active'}</span>
          <span className="ml-auto flex gap-1.5">
            {paused
              ? <button type="button" className="btn-primary" onClick={() => api.reminders.pause(null)}>Resume</button>
              : [30, 60, 180].map((m) => <button key={m} type="button" className="btn-outline" onClick={() => api.reminders.pause(m)}>Pause {m < 60 ? `${m}m` : `${m / 60}h`}</button>)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 py-3">
          <Field label="Default reminder" htmlFor="lead">
            <select id="lead" className="input" value={s.defaultLeadMinutes} onChange={(e) => update({ defaultLeadMinutes: Number(e.target.value) })}>
              {[0, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m ? `${m} min before` : 'At the time'}</option>)}
            </select>
          </Field>
          <Field label="Default snooze" htmlFor="snz">
            <select id="snz" className="input" value={s.defaultSnoozeMinutes} onChange={(e) => update({ defaultSnoozeMinutes: Number(e.target.value) })}>
              {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </Field>
          <Field label="How reminders appear" htmlFor="mode">
            <select id="mode" className="input" value={s.notificationMode} onChange={(e) => update({ notificationMode: e.target.value })}>
              <option value="buddy">Buddy only</option>
              <option value="buddy+system">Buddy + Windows notification</option>
              <option value="system">Windows notification only</option>
            </select>
          </Field>
          <Field label="Intensity" htmlFor="int">
            <select id="int" className="input" value={s.intensity} onChange={(e) => update({ intensity: e.target.value })}>
              <option value="subtle">Subtle — bubble in place, chime</option>
              <option value="normal">Normal — runs to centre, chime, voice</option>
              <option value="strong">Strong — also notification + one re-chime</option>
            </select>
          </Field>
          <Field label="Keep reminder up for" htmlFor="to">
            <select id="to" className="input" value={s.alertTimeoutMinutes} onChange={(e) => update({ alertTimeoutMinutes: Number(e.target.value) })}>
              {[5, 15, 30, 60, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}</option>)}
            </select>
          </Field>
          <Field label="Missed while away" htmlFor="missed" hint="After sleep, restarts or while closed">
            <select id="missed" className="input" value={s.missedPolicy} onChange={(e) => update({ missedPolicy: e.target.value })}>
              <option value="notify">Show them (grouped if many)</option>
              <option value="skip">Skip them quietly</option>
            </select>
          </Field>
        </div>
        <Toggle label="Run to the centre of the screen" description="Turn off to remind from where the buddy stands"
          checked={s.centerAnimation} onChange={(v) => update({ centerAnimation: v })} />
        <div className="py-3">
          <Toggle label="Quiet hours" description="Hold reminders and break nudges during these hours"
            checked={s.quietHours.enabled} onChange={(v) => update({ quietHours: { ...s.quietHours, enabled: v } })} />
          {s.quietHours.enabled && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <input type="time" className="input w-32" aria-label="Quiet hours start" value={s.quietHours.start}
                onChange={(e) => update({ quietHours: { ...s.quietHours, start: e.target.value } })} />
              to
              <input type="time" className="input w-32" aria-label="Quiet hours end" value={s.quietHours.end}
                onChange={(e) => update({ quietHours: { ...s.quietHours, end: e.target.value } })} />
            </div>
          )}
        </div>
        <div className="py-3">
          <Field label="Break nudges (water, stretch, eyes)" htmlFor="brk">
            <select id="brk" className="input w-auto" value={s.breakEveryMin} onChange={(e) => update({ breakEveryMin: Number(e.target.value) })}>
              <option value={0}>Off</option><option value={30}>Every 30 min</option><option value={60}>Every hour</option><option value={90}>Every 90 min</option><option value={120}>Every 2 hours</option>
            </select>
          </Field>
        </div>
        {status && <p className="py-2 text-xs text-stone-500">{status.pending} scheduled · next {status.next ? new Date(status.next).toLocaleString() : '—'}{status.failed ? ` · ${status.failed} failed deliveries (see logs)` : ''}</p>}
      </Section>

      <AppearanceSection s={s} update={update} />

      <Section title="Sound & voice">
        <Toggle label="Chime" checked={s.sound} onChange={(v) => update({ sound: v })} />
        <div className="flex items-end gap-2 py-3">
          <Field label="Chime style" htmlFor="chime">
            <select id="chime" className="input" value={s.chimeStyle} disabled={!s.sound}
              onChange={(e) => { update({ chimeStyle: e.target.value }); window.playChime(e.target.value, s.volume); }}>
              {Object.entries(window.CHIMES).map(([id, c]) => <option key={id} value={id}>{c.name}</option>)}
            </select>
          </Field>
          <button type="button" className="btn-outline" disabled={!s.sound} onClick={() => window.playChime(s.chimeStyle, s.volume)}>▶ Play</button>
        </div>
        <div className="py-3">
          <label className="label" htmlFor="vol">Volume · {Math.round(s.volume * 100)}%</label>
          <input id="vol" type="range" min={0} max={1} step={0.05} className="w-full accent-brand-500" value={s.volume} onChange={(e) => update({ volume: Number(e.target.value) })} />
        </div>
        <Toggle label="Read reminders aloud" checked={s.speech} onChange={(v) => update({ speech: v })} />
        <div className="flex items-end gap-2 py-3">
          <Field label="Voice" htmlFor="voice">
            <select id="voice" className="input" value={s.voice} disabled={!s.speech} onChange={(e) => update({ voice: e.target.value })}>
              <option value="">System default</option>
              {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
            </select>
          </Field>
          <button type="button" className="btn-outline" disabled={!s.speech} onClick={testVoice}>▶ Test</button>
        </div>
      </Section>

      <Section title="General">
        <Toggle label="Start with Windows" description="Recommended — reminders only work while Desktop Buddy is running"
          checked={s.startWithWindows} onChange={(v) => update({ startWithWindows: v })} />
        <Toggle label="Start minimized" description="When started with Windows, keep the buddy hidden (tray only)"
          checked={s.startHidden} onChange={(v) => update({ startHidden: v })} />
        <div className="flex items-center justify-between gap-4 py-3">
          <span><span className="block text-sm font-medium">Welcome tour</span><span className="block text-xs text-stone-500">Meet your buddy again: pick a look, a name and learn the shortcuts</span></span>
          <button type="button" className="btn-outline shrink-0" onClick={() => navigate('/welcome')}>Replay tour</button>
        </div>
        <div className="grid grid-cols-2 gap-4 py-3">
          <Field label="Default time zone" htmlFor="tz" hint={info && info.systemTimeZone !== s.timeZone ? `Windows is set to ${info.systemTimeZone}` : 'Used for new tasks'}>
            <select id="tz" className="input" value={s.timeZone} onChange={(e) => update({ timeZone: e.target.value })}>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </Field>
        </div>
      </Section>

      <UpdatesSection s={s} update={update} />
      <CaptureSection s={s} update={update} />
      <AiSection />

      <Section title="Crash reports" description="Help fix bugs faster. Reports contain the error message, the code location, your app version and Windows version. No tasks, notes, bookmarks or personal files, and folder names are removed.">
        <Toggle label="Send anonymous crash reports" checked={s.crashReports} onChange={(v) => update({ crashReports: v })} />
      </Section>

      <Section title="Privacy & data" description="Your tasks and bookmarks are stored on this computer. Bookmarks are never synced. Cloud sync for tasks is optional (Account & sync).">
        <div className="flex flex-wrap gap-2 py-3">
          <button type="button" className="btn-outline" onClick={async () => { const p = await api.sync.exportData(); if (p) toast(`Exported to ${p}`); }}>Export my data</button>
          <button type="button" className="btn-outline" onClick={() => api.app.openLogs()}>Open log folder</button>
          <button type="button" className="btn-outline text-red-600" onClick={async () => {
            try { const n = await api.bookmarks.clearAll(); if (n != null) toast(`Deleted ${n} bookmark${n === 1 ? '' : 's'}`); } catch (err) { toast(err.message, 'error'); }
          }}>Delete all bookmarks…</button>
        </div>
        {info && (
          <p className="py-2 text-xs text-stone-500">
            Version {info.version} · database schema v{info.schemaVersion} · data in <span className="break-all">{info.dataDir}</span>
          </p>
        )}
      </Section>
    </div>
  );
}
