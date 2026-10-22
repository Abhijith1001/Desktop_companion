import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { useToasts, useSettings } from '../stores';
import { Toggle } from '../components/ui';
import PhoneScreen from '../features/phone/PhoneScreen';
import { webCodecsSupported } from '../features/phone/decoder';
import Icon from '../components/Icon';
import QrPair from '../features/phone/QrPair';
import PhoneNotifications from '../features/phone/PhoneNotifications';

const PREFS_KEY = 'buddy.phone.prefs';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ } };

// "192.168.1.20:37155" → { host, port }
function parseAddress(text) {
  const m = String(text).trim().match(/^([^\s:]+):(\d{1,5})$/);
  return m ? { host: m[1], port: Number(m[2]) } : null;
}

const START_APPS = [
  { pkg: 'com.whatsapp', label: 'WhatsApp' },
  { pkg: 'com.whatsapp.w4b', label: 'WhatsApp Business' },
  { pkg: 'org.telegram.messenger', label: 'Telegram' },
  { pkg: 'com.instagram.android', label: 'Instagram' },
  { pkg: 'com.google.android.apps.messaging', label: 'Messages' },
  { pkg: '', label: 'Home screen' },
];

const STATE_TEXT = { device: 'Ready', unauthorized: 'Allow on phone', offline: 'Offline' };

export default function PhonePage() {
  const toast = useToasts((s) => s.push);
  const phoneAlerts = useSettings((s) => s.settings.phoneAlerts);
  const phoneAlertsAll = useSettings((s) => s.settings.phoneAlertsAll);
  const phoneLink = useSettings((s) => s.settings.phoneLink);
  const phoneBluetooth = useSettings((s) => s.settings.phoneBluetooth);
  const updateSettings = useSettings((s) => s.update);
  const [status, setStatus] = useState(null);
  const [devices, setDevices] = useState([]);
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState(null);
  const [prefs, setPrefs] = useState(() => ({ quality: 'balanced', screenOff: false, mode: 'separate', startApp: 'com.whatsapp', ...loadPrefs() }));
  const [pairAddr, setPairAddr] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [connectAddr, setConnectAddr] = useState(() => loadPrefs().lastAddress || '');
  const [screenOff, setScreenOff] = useState(false);
  const [bt, setBt] = useState({ state: 'off', device: null });

  const updatePrefs = (patch) => setPrefs((p) => { const next = { ...p, ...patch }; savePrefs(next); return next; });

  const refresh = useCallback(async () => {
    try { setDevices(await api.phone.devices()); } catch (err) { toast(err.message, 'error'); }
  }, [toast]);

  useEffect(() => {
    // A running session is picked up as is: it keeps going while you're on
    // other pages or the window is closed, until you press Stop.
    api.phone.status().then((s) => {
      setStatus(s);
      if (s.available) refresh();
    });
    api.phone.btStatus().then(setBt).catch(() => {});
    const offBt = api.phone.onBt(setBt);
    const off = api.phone.onStatus((s) => {
      setStatus((prev) => ({ ...prev, ...s }));
      if (s.state === 'error') toast(s.message, 'error');
    });
    // Picks up a phone that reconnected by itself in the background.
    const t = setInterval(() => { if (!document.hidden) api.phone.devices().then(setDevices).catch(() => {}); }, 10_000);
    return () => { off(); offBt(); clearInterval(t); };
  }, [refresh, toast]);

  async function run(label, fn) {
    setBusy(label);
    try { return await fn(); } catch (err) { toast(err.message, 'error'); return null; } finally { setBusy(null); }
  }

  const discover = () => run('discover', async () => {
    const list = await api.phone.discover();
    setFound(list);
    const pairing = list.find((d) => d.kind === 'pairing');
    const conn = list.find((d) => d.kind === 'connect');
    if (pairing && !pairAddr) setPairAddr(`${pairing.host}:${pairing.port}`);
    if (conn) setConnectAddr(`${conn.host}:${conn.port}`);
    if (!list.length) toast('No phones found. Keep the Wireless debugging screen open on the phone and try again.');
  });

  const pair = () => run('pair', async () => {
    const a = parseAddress(pairAddr);
    if (!a) throw new Error('Enter the address as IP:port, e.g. 192.168.1.20:37155');
    await api.phone.pair(a.host, a.port, pairCode.trim());
    setPairCode('');
    toast('Paired! Now connect using the address on the Wireless debugging screen.', 'success');
    setConnectAddr((c) => c || `${a.host}:`);
    setTimeout(refresh, 1500); // the phone often connects by itself after pairing
  });

  const connect = () => run('connect', async () => {
    const a = parseAddress(connectAddr);
    if (!a) throw new Error('Enter the address as IP:port, e.g. 192.168.1.20:41023');
    await api.phone.connect(a.host, a.port);
    updatePrefs({ lastAddress: connectAddr.trim() });
    await refresh();
  });

  // Linking keeps the phone connected for notifications, across closing the
  // window and app restarts. A Wi-Fi address is remembered for reconnecting.
  const link = (d) => {
    const address = d.wifi && /^[\w.-]+:\d+$/.test(d.serial) ? d.serial : (phoneLink?.address ?? null);
    return updateSettings({ phoneLink: { enabled: true, address } });
  };
  const unlink = () => run('unlink', async () => {
    await api.phone.stop();
    await updateSettings({ phoneLink: { enabled: false, address: null } });
    toast('Phone unlinked. Notifications are off until you link it again.');
  });

  const notificationsOnly = (d) => run('link', async () => {
    await link(d);
    toast('Linked! Notifications keep coming even when this window is closed.', 'success');
  });

  const mirror = (serial) => run('mirror', async () => {
    const d = devices.find((x) => x.serial === serial);
    if (d) await link(d);
    const separate = prefs.mode === 'separate';
    setScreenOff(!separate && prefs.screenOff);
    await api.phone.start(serial, {
      quality: prefs.quality, mode: prefs.mode, screenOff: !separate && prefs.screenOff,
      startApp: prefs.startApp || null,
    });
  });

  const press = (button) => api.phone.input({ kind: 'button', button }).catch(() => {});
  const onDecodeError = useCallback((err) => console.warn('phone decoder', err), []);

  if (!status) return null;

  if (!status.available) {
    return (
      <Shell>
        <div className="card p-5 text-sm">
          <p className="font-semibold">Phone tools are missing</p>
          <p className="mt-1 text-stone-500 dark:text-stone-400">Run <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">node scripts/fetch-phone-tools.js</code> and restart the app.</p>
        </div>
      </Shell>
    );
  }
  if (!webCodecsSupported()) {
    return <Shell><div className="card p-5 text-sm">This build can't decode video (WebCodecs is unavailable).</div></Shell>;
  }

  if (status.state === 'live' || status.state === 'starting') {
    const live = status.state === 'live';
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'}`} />
          <span className="flex-1 truncate text-sm font-semibold">{live ? status.device : 'Starting mirror…'}</span>
          <ToolButton label="Volume down" onClick={() => press('volumeDown')}>Vol −</ToolButton>
          <ToolButton label="Volume up" onClick={() => press('volumeUp')}>Vol +</ToolButton>
          <ToolButton label="Notifications" onClick={() => press('notifications')}><Icon name="bell" size={16} /></ToolButton>
          <ToolButton label="Rotate" onClick={() => press('rotate')}><Icon name="repeat" size={16} /></ToolButton>
          <ToolButton label={screenOff ? 'Turn phone screen on' : 'Turn phone screen off (keeps mirroring)'}
            onClick={() => { const next = !screenOff; setScreenOff(next); api.phone.input({ kind: 'screen', on: !next }).catch(() => {}); }}>
            {screenOff ? 'Screen on' : 'Screen off'}
          </ToolButton>
          <ToolButton label="Power" onClick={() => press('power')}>Power</ToolButton>
          <button type="button" className="btn-danger" onClick={() => api.phone.stop()}>Stop</button>
        </div>
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            {/* Mounted while starting too, so the first key frame isn't missed. */}
            <PhoneScreen label={status.device || 'Phone'} onDecodeError={onDecodeError} />
            <div className="flex justify-center gap-2">
              <ToolButton label="Back" onClick={() => press('back')}>◀ Back</ToolButton>
              <ToolButton label="Home" onClick={() => press('home')}>● Home</ToolButton>
              <ToolButton label="Recent apps" onClick={() => press('recents')}>■ Recents</ToolButton>
            </div>
            <p className="text-center text-xs text-stone-500 dark:text-stone-400">
              Click to tap · drag to swipe · scroll wheel to scroll · type to enter text · Ctrl+V pastes · right-click or Esc = Back
            </p>
          </div>
          <PhoneNotifications className="hidden w-80 shrink-0 lg:flex" />
        </div>
      </div>
    );
  }

  const ready = devices.filter((d) => d.state === 'device');
  return (
    <Shell>
      {phoneLink?.enabled && (
        <section className="card flex flex-wrap items-center gap-3 border-emerald-500/40 p-4">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ready.length ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{ready.length ? `Linked to ${ready[0].model}` : 'Phone linked, reconnecting…'}</p>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {ready.length
                ? 'Notifications keep coming, even when you close this window.'
                : 'Make sure Wireless debugging is on and the phone is on the same Wi-Fi. It reconnects by itself.'}
            </p>
          </div>
          {ready.length > 0 && <button type="button" className="btn-primary" disabled={!!busy} onClick={() => mirror(ready[0].serial)}><Icon name="phone" size={16} />Mirror screen</button>}
          <button type="button" className="btn-ghost" disabled={!!busy} onClick={unlink}>Unlink</button>
        </section>
      )}
      <BluetoothCard on={!!phoneBluetooth} bt={bt} onToggle={(v) => updateSettings({ phoneBluetooth: v })} />
      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Your phones</h2>
          <button type="button" className="btn-ghost" onClick={refresh}>Refresh</button>
        </div>
        {devices.length === 0 ? (
          <p className="text-sm text-stone-500 dark:text-stone-400">No phone connected yet. Pair one below, or plug it in with USB debugging on.</p>
        ) : (
          <ul className="divide-y divide-stone-200 dark:divide-stone-800">
            {devices.map((d) => (
              <li key={d.serial} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.model}</p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">{d.wifi ? 'Wi-Fi' : 'USB'} · {STATE_TEXT[d.state] || d.state}</p>
                </div>
                {d.wifi && <button type="button" className="btn-ghost" onClick={() => run('disconnect', async () => { await api.phone.disconnect(d.serial); await refresh(); })}>Disconnect</button>}
                <button type="button" className="btn-outline" disabled={d.state !== 'device' || !!busy} onClick={() => notificationsOnly(d)}>
                  <Icon name="bell" size={16} />Notifications only
                </button>
                <button type="button" className="btn-primary" disabled={d.state !== 'device' || !!busy} onClick={() => mirror(d.serial)}>
                  <Icon name="phone" size={16} />{busy === 'mirror' ? 'Starting…' : 'Mirror screen'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-stone-200 pt-4 text-sm dark:border-stone-800">
          <label className="flex items-center gap-2">Quality
            <select className="input w-auto" value={prefs.quality} onChange={(e) => updatePrefs({ quality: e.target.value })}>
              <option value="low">Low (smoothest on slow Wi-Fi)</option>
              <option value="balanced">Balanced</option>
              <option value="high">High (full resolution)</option>
            </select>
          </label>
          <label className="flex items-center gap-2">Mode
            <select className="input w-auto" value={prefs.mode} onChange={(e) => updatePrefs({ mode: e.target.value })}>
              <option value="separate">Separate screen (phone stays free)</option>
              <option value="mirror">Mirror (same as phone)</option>
            </select>
          </label>
          <label className="flex items-center gap-2">Start with
            <select className="input w-auto" value={prefs.startApp || ''} onChange={(e) => updatePrefs({ startApp: e.target.value || null })}>
              {START_APPS.map((a) => <option key={a.pkg} value={a.pkg}>{a.label}</option>)}
            </select>
          </label>
          {prefs.mode === 'mirror' && <label className="flex items-center gap-2">
            <input type="checkbox" checked={prefs.screenOff} onChange={(e) => updatePrefs({ screenOff: e.target.checked })} />
            Turn phone screen off while mirroring
          </label>}
        </div>
        <div className="mt-3 border-t border-stone-200 pt-2 dark:border-stone-800">
          <Toggle label="Buddy tells me about new messages" checked={phoneAlerts !== false}
            description="While a phone is connected, your buddy says who messaged you (WhatsApp, Telegram, Instagram, Messages, Signal and more). The bubble shows only the sender, never the message."
            onChange={(v) => updateSettings({ phoneAlerts: v })} />
          <Toggle label="…for every app" checked={!!phoneAlertsAll} disabled={phoneAlerts === false}
            description="Also announce notifications from other apps, like Gmail, Flipkart or YouTube."
            onChange={(v) => updateSettings({ phoneAlertsAll: v })} />
        </div>
        {prefs.mode === 'separate' && (
          <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
            Apps open on a hidden second screen, so you can use your phone normally at the same time. Some phones can't show their home screen there, so pick an app to start with.
          </p>
        )}
        {ready.length === 0 && devices.some((d) => d.state === 'unauthorized') && (
          <p className="mt-3 text-sm text-amber-600">Check your phone and tap “Allow” on the USB debugging prompt.</p>
        )}
      </section>

      {(ready.length > 0 || bt.state === 'connected') && <PhoneNotifications className="max-h-[28rem]" />}

      <section className="card p-5">
        <h2 className="font-semibold">Connect over Wi-Fi</h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">Android 11 or newer, on the same Wi-Fi as this PC.</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-stone-600 dark:text-stone-300">
          <li>On the phone, open <b>Settings → About phone</b> and tap <b>Build number</b> 7 times to unlock Developer options.</li>
          <li>Open <b>Settings → System → Developer options → Wireless debugging</b> and turn it on.</li>
          <li>Tap <b>Pair device with QR code</b> and scan the code below. That's it. (Only needed once per PC.)</li>
        </ol>
        <QrPair onDone={refresh} />
        <p className="mt-4 text-sm font-medium">Or enter the details by hand</p>
        <button type="button" className="btn-outline mt-2" disabled={!!busy} onClick={discover}>
          <Icon name="search" size={16} />{busy === 'discover' ? 'Searching…' : 'Find phones on my Wi-Fi'}
        </button>
        {found.length > 0 && <p className="mt-2 text-xs text-stone-500">Found: {found.map((f) => `${f.host}:${f.port} (${f.kind})`).join(', ')}</p>}

        <form className="mt-4 grid gap-2 sm:grid-cols-[1fr_8rem_auto]" onSubmit={(e) => { e.preventDefault(); pair(); }}>
          <label className="sr-only" htmlFor="pair-addr">Pairing address</label>
          <input id="pair-addr" className="input" placeholder="Pairing IP:port, e.g. 192.168.1.20:37155" value={pairAddr} onChange={(e) => setPairAddr(e.target.value)} />
          <label className="sr-only" htmlFor="pair-code">Pairing code</label>
          <input id="pair-code" className="input" inputMode="numeric" maxLength={6} placeholder="6-digit code" value={pairCode} onChange={(e) => setPairCode(e.target.value.replace(/\D/g, ''))} />
          <button type="submit" className="btn-outline" disabled={!!busy || pairCode.length !== 6}>{busy === 'pair' ? 'Pairing…' : 'Pair'}</button>
        </form>
        <form className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]" onSubmit={(e) => { e.preventDefault(); connect(); }}>
          <label className="sr-only" htmlFor="connect-addr">Connect address</label>
          <input id="connect-addr" className="input" placeholder="Connect IP:port, e.g. 192.168.1.20:41023" value={connectAddr} onChange={(e) => setConnectAddr(e.target.value)} />
          <button type="submit" className="btn-primary" disabled={!!busy || !connectAddr}>{busy === 'connect' ? 'Connecting…' : 'Connect'}</button>
        </form>
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
          The phone's screen streams directly to this PC over your local network. Nothing is sent to Desktop Buddy's servers.
          Wireless debugging turns itself off after a restart or Wi-Fi change; just connect again.
        </p>
      </section>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    // `relative` anchors the forms' sr-only labels; without it they're placed
    // against the page and stretch the scroll area past the content.
    <div className="relative mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6 lg:py-8">
      <div>
        <h1 className="page-title">Phone</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">See and control your Android phone from here: reply to WhatsApp, check apps, without picking it up.</p>
      </div>
      {children}
    </div>
  );
}

function ToolButton({ label, onClick, children }) {
  return <button type="button" className="btn-outline" title={label} aria-label={label} onClick={onClick}>{children}</button>;
}

const BT_TEXT = {
  connected: 'Notifications are coming in over Bluetooth.',
  searching: 'Looking for your phone… Keep Bluetooth on and Buddy Link set up on the phone.',
  nophone: 'No paired phone. Pair your phone with this PC in Windows Bluetooth settings first.',
  error: "Couldn't use Bluetooth on this PC. Check that Bluetooth is turned on.",
};

// Notifications without Wi-Fi or adb: the Buddy Link Android app sends them
// over Bluetooth and reconnects by itself, like a smartwatch.
function BluetoothCard({ on, bt, onToggle }) {
  const connected = on && bt.state === 'connected';
  return (
    <section className="card p-5">
      <Toggle label="Get notifications over Bluetooth" checked={on} onChange={onToggle}
        description="Needs the Buddy Link app on your phone (android/BuddyLink.apk) and the phone paired with this PC. No Wi-Fi, USB or debugging needed; it reconnects by itself." />
      {on && (
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${connected ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'}`} />
          <span className="font-medium">{connected ? `Connected to ${bt.device || 'phone'}` : 'Not connected'}</span>
          <span className="text-stone-500 dark:text-stone-400">· {BT_TEXT[bt.state] || BT_TEXT.searching}</span>
        </div>
      )}
      {on && <FileShare connected={connected} />}
    </section>
  );
}

const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const TRANSFER_STATE = { done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };

// Send files to the phone (drop or pick) and see what's on the way, both ways.
// Files shared from the phone ("Share › Desktop Buddy") land in Downloads.
function FileShare({ connected }) {
  const toast = useToasts((s) => s.push);
  const [list, setList] = useState([]);
  const [over, setOver] = useState(false);

  useEffect(() => {
    api.phone.transfers().then(setList).catch(() => {});
    return api.phone.onTransfers(setList);
  }, []);

  const send = async (fn) => { try { await fn(); } catch (err) { toast(err.message, 'error'); } };
  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    send(async () => {
      const paths = (await Promise.all(files.map((f) => api.phone.pathForFile(f)))).filter(Boolean);
      if (!paths.length) throw new Error("Couldn't read those files. Folders can't be sent; send the files inside them.");
      await api.phone.sendFiles(paths);
    });
  };

  return (
    <div className="mt-4 border-t border-stone-200 pt-4 dark:border-stone-800">
      <div
        onDragOver={(e) => { if (connected) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={connected ? onDrop : undefined}
        className={`flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed p-4 text-sm transition-colors ${over ? 'border-brand-500 bg-brand-500/10' : 'border-stone-300 dark:border-stone-700'} ${connected ? '' : 'opacity-60'}`}
      >
        <Icon name="phone" size={20} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{connected ? 'Drop files here to send them to your phone' : 'Connect your phone to share files'}</p>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            From the phone: Share › Desktop Buddy. Files land in your Downloads folder. Bluetooth is best for photos and documents (about 20 s for a 3 MB photo).
          </p>
        </div>
        <button type="button" className="btn-outline" disabled={!connected} onClick={() => send(() => api.phone.pickFiles())}>Choose files…</button>
      </div>
      {list.length > 0 && (
        <ul className="mt-3 divide-y divide-stone-200 dark:divide-stone-800">
          {list.map((t) => {
            const pct = t.size ? Math.min(100, Math.round((t.done / t.size) * 100)) : 0;
            return (
              <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-5 text-center" title={t.dir === 'in' ? 'From phone' : 'To phone'}>{t.dir === 'in' ? '📥' : '📤'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.name}</p>
                  {t.state === 'active' ? (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                        <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">{pct}% · {fmtSize(t.done)} of {fmtSize(t.size)}</span>
                    </div>
                  ) : (
                    <p className={`text-xs ${t.state === 'done' ? 'text-emerald-600' : 'text-stone-500 dark:text-stone-400'}`}>
                      {TRANSFER_STATE[t.state]}{t.state === 'done' ? ` · ${fmtSize(t.size)}` : t.error ? ` · ${t.error}` : ''}
                    </p>
                  )}
                </div>
                {t.state === 'active' && <button type="button" className="btn-ghost" onClick={() => send(() => api.phone.cancelTransfer(t.id))}>Cancel</button>}
                {t.saved && <button type="button" className="btn-ghost" onClick={() => send(() => api.phone.showTransfer(t.id))}>Show in folder</button>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
