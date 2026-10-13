import { useEffect, useState } from 'react';
import { useProgress, useSettings, useToasts } from '../stores';
import { BuddyPreview, Section } from '../components/ui';
import { bgCss } from '../features/progress/backgrounds';
import { renderRecap } from '../features/progress/recapImage';

const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fmtDay = (iso) => dayFmt.format(new Date(`${iso}T12:00:00`));

function LevelCard({ p, settings }) {
  const into = p.xp - p.levelStartXp;
  const span = p.nextLevelXp - p.levelStartXp;
  return (
    <section className="card flex flex-col items-center gap-5 overflow-hidden p-0 sm:flex-row">
      <div className="grid h-48 w-full shrink-0 place-items-center sm:w-64" style={{ background: bgCss(settings.background) }}>
        <BuddyPreview id={settings.character} accessory={settings.accessory} state={p.completedToday ? 'happy' : 'idle'} />
      </div>
      <div className="w-full space-y-3 p-5 sm:pl-0">
        <div className="flex items-baseline gap-2">
          <h2 className="text-2xl font-extrabold">Level {p.level}</h2>
          <span className="chip bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100">{p.stage}</span>
        </div>
        <div>
          <div className="h-3 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800" role="progressbar"
            aria-valuemin={0} aria-valuemax={span} aria-valuenow={into} aria-label="XP to next level">
            <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(into / span) * 100}%` }} />
          </div>
          <p className="mt-1 text-xs text-stone-500">{into} / {span} XP to level {p.level + 1} · {p.xp} XP total</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[[`🔥 ${p.streak}`, 'day streak'], [`✅ ${p.completedToday}`, 'done today'], [`🏅 ${p.longestStreak}`, 'best streak']].map(([big, small]) => (
            <div key={small} className="rounded-xl bg-stone-100 py-2 dark:bg-stone-800">
              <div className="text-lg font-bold">{big}</div>
              <div className="text-xs text-stone-500">{small}</div>
            </div>
          ))}
        </div>
        {p.streak > 0 && p.completedToday === 0 && (
          <p className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Finish one task today to keep your {p.streak}-day streak going.
          </p>
        )}
      </div>
    </section>
  );
}

function Recap({ p, settings }) {
  const r = p.recap;
  const [url, setUrl] = useState(null);
  const [blob, setBlob] = useState(null);
  const push = useToasts((s) => s.push);

  useEffect(() => {
    let alive = true;
    let made;
    renderRecap({ recap: r, progress: p, character: settings.character, accessory: settings.accessory, background: settings.background, buddyName: settings.buddyName })
      .then((b) => { if (!alive || !b) return; made = URL.createObjectURL(b); setBlob(b); setUrl(made); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [JSON.stringify(r), p.level, p.streak, settings.character, settings.accessory, settings.background, settings.buddyName]);

  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      push('Recap copied — paste it anywhere');
    } catch {
      push('Could not copy the image. Try saving it instead.', 'error');
    }
  };

  return (
    <Section title="Weekly recap" description={`${fmtDay(r.from)} – ${fmtDay(r.to)}`}>
      <div className="flex flex-col gap-4 pt-3 sm:flex-row">
        <div className="aspect-square w-full max-w-64 shrink-0 overflow-hidden rounded-xl bg-stone-100 dark:bg-stone-800">
          {url && <img src={url} alt={`Weekly recap: ${r.total} tasks finished`} className="h-full w-full" />}
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-lg font-bold">You finished {r.total} {r.total === 1 ? 'task' : 'tasks'} this week!</p>
          {r.bestDay && <p>Best day: <b>{fmtDay(r.bestDay.date)}</b> with {r.bestDay.count} done.</p>}
          {r.topCategory && <p>Most of your work went into <b>{r.topCategory}</b>.</p>}
          {r.newBadges.length > 0 && (
            <p>New badges: {r.newBadges.map((id) => p.achievements.find((a) => a.id === id)).map((a) => `${a.emoji} ${a.name}`).join(', ')}</p>
          )}
          <div className="mt-auto flex gap-2 pt-2">
            <button type="button" className="btn-primary" disabled={!blob} onClick={copy}>Copy image</button>
            <a className={`btn-outline ${url ? '' : 'pointer-events-none opacity-50'}`} href={url || undefined} download={`buddy-recap-${r.to}.png`}>Save image</a>
          </div>
        </div>
      </div>
    </Section>
  );
}

function Achievements({ p }) {
  const got = p.achievements.filter((a) => a.unlockedAt).length;
  return (
    <Section title="Badges" description={`${got} of ${p.achievements.length} earned`}>
      <ul className="grid grid-cols-2 gap-2 pt-3 sm:grid-cols-3 lg:grid-cols-4">
        {p.achievements.map((a) => (
          <li key={a.id} className={`rounded-xl border p-3 ${a.unlockedAt ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/30' : 'border-stone-200 opacity-60 dark:border-stone-800'}`}
            title={a.unlockedAt ? `Earned ${new Date(a.unlockedAt).toLocaleDateString()}` : 'Not earned yet'}>
            <div className={`text-2xl ${a.unlockedAt ? '' : 'grayscale'}`} aria-hidden="true">{a.unlockedAt ? a.emoji : '🔒'}</div>
            <div className="text-sm font-bold">{a.name}</div>
            <div className="text-xs text-stone-500">{a.description}</div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Rewards({ p, settings, equip }) {
  const group = (kind) => p.rewards.filter((r) => r.kind === kind);
  return (
    <Section title="Rewards" description="Unlock accessories and backgrounds by earning badges and levelling up.">
      <h3 className="pt-3 text-sm font-semibold">Accessories</h3>
      <div className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-4">
        <RewardTile label="None" active={!settings.accessory} onClick={() => equip({ accessory: null })}>
          <BuddyPreview id={settings.character} size={0.5} />
        </RewardTile>
        {group('accessory').map((r) => (
          <RewardTile key={r.id} label={r.name} locked={!r.unlocked} hint={r.requirement} active={settings.accessory === r.id}
            onClick={() => equip({ accessory: r.id })}>
            <BuddyPreview id={settings.character} accessory={r.id} size={0.5} />
          </RewardTile>
        ))}
      </div>
      <h3 className="pt-3 text-sm font-semibold">Backgrounds</h3>
      <div className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-5">
        {group('background').map((r) => (
          <RewardTile key={r.id} label={r.name} locked={!r.unlocked} hint={r.requirement} active={settings.background === r.id}
            onClick={() => equip({ background: r.id })}>
            <div className="h-16 w-full rounded-lg" style={{ background: bgCss(r.id) }} />
          </RewardTile>
        ))}
      </div>
    </Section>
  );
}

function RewardTile({ label, locked, hint, active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} disabled={locked} aria-pressed={active}
      title={locked ? hint : label}
      className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-xs ${active ? 'border-brand-500 ring-2 ring-brand-500' : 'border-stone-200 dark:border-stone-800'} ${locked ? 'cursor-not-allowed opacity-50 grayscale' : 'hover:shadow-sm'}`}>
      {children}
      <span className="font-semibold">{locked ? '🔒 ' : ''}{label}</span>
      {locked && <span className="text-[10px] text-stone-500">{hint}</span>}
    </button>
  );
}

export default function ProgressPage() {
  const { state: p, load, equip } = useProgress();
  const settings = useSettings((s) => s.settings);
  useEffect(() => { load(); }, [load]);
  if (!p) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <header>
        <h1 className="page-title">Progress</h1>
        <p className="text-sm text-stone-500">Every task you finish earns XP. Keep a daily streak going to help your buddy grow.</p>
      </header>
      <LevelCard p={p} settings={settings} />
      <Recap p={p} settings={settings} />
      <Achievements p={p} />
      <Rewards p={p} settings={settings} equip={equip} />
    </div>
  );
}
