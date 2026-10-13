import { useState } from 'react';
import { useSettings } from '../stores';
import { api } from '../services/api';
import { BuddyPreview, Section, Toggle } from '../components/ui';

const PERSONALITIES = {
  dog: 'Friendly, caring and cheerful. Celebrates every win with you.',
  tom: 'Playful and a little mischievous, with humorous (but kind) reminders.',
  cat: 'Expressive and curious. Purrs when you finish things.',
  hero: 'Energetic and encouraging. Turns tasks into missions and streaks.',
  ranger: 'Calm, organised and practical. Keeps your schedule on track.',
};

const STATES = [
  ['idle', 'Idle'], ['walk', 'Walk'], ['run', 'Run'], ['sit', 'Sit'], ['look', 'Look around'],
  ['happy', 'Celebrate'], ['alert', 'Reminder'], ['speak', 'Speak'], ['sleep', 'Sleep'],
];

export default function CharactersPage() {
  const { settings, update } = useSettings();
  const [state, setState] = useState('walk');
  const ids = Object.keys(window.CHARACTERS);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <header>
        <h1 className="page-title">Characters</h1>
        <p className="text-sm text-stone-500">All characters share the same tasks and reminders — only their look, moves and voice differ.</p>
      </header>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preview animation">
        {STATES.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={state === id} onClick={() => setState(id)}
            className={`chip border px-3 py-1 ${state === id ? 'border-brand-500 bg-brand-500 text-stone-950' : 'border-stone-300 dark:border-stone-700'}`}>{label}</button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ids.map((id) => {
          const c = window.CHARACTERS[id];
          const active = settings.character === id;
          return (
            <button key={id} type="button" onClick={() => update({ character: id })} aria-pressed={active}
              className={`card flex flex-col items-center gap-2 p-4 text-center transition-shadow hover:shadow-md ${active ? 'ring-2 ring-brand-500' : ''}`}>
              <div className="grid h-40 w-full place-items-center rounded-xl bg-gradient-to-b from-sky-50 to-brand-50 dark:from-stone-800 dark:to-stone-900">
                <BuddyPreview id={id} state={state} accessory={settings.accessory} />
              </div>
              <span className="text-base font-bold">{c.name} {active && <span className="chip ml-1 bg-brand-500 text-stone-950">Selected</span>}</span>
              <span className="text-xs text-stone-500">{PERSONALITIES[id] || 'A custom character.'}</span>
            </button>
          );
        })}
      </div>

      <Section title="Behaviour">
        <div className="py-3">
          <label className="label" htmlFor="size">Size · {Math.round(settings.characterSize * 100)}%</label>
          <input id="size" type="range" min={0.75} max={1.5} step={0.05} className="w-full accent-brand-500"
            value={settings.characterSize} onChange={(e) => update({ characterSize: Number(e.target.value) })} />
        </div>
        <div className="py-3">
          <label className="label" htmlFor="anim">Animation</label>
          <select id="anim" className="input w-auto" value={settings.animation} onChange={(e) => update({ animation: e.target.value })}>
            <option value="full">Full — walks around and plays</option>
            <option value="reduced">Reduced — stays put, gentle motion</option>
            <option value="off">Off — still image</option>
          </select>
          <p className="mt-1 text-xs text-stone-500">Windows’ “reduce animations” setting is also respected automatically.</p>
        </div>
        <Toggle label="Personality dialogue" description="Character-specific lines. Off = plain, straightforward reminders."
          checked={settings.personality} onChange={(v) => update({ personality: v })} />
        <Toggle label="Show buddy on desktop" description="Hide it temporarily — reminders keep working. Shortcut: Ctrl+Alt+B"
          checked={!settings.buddyHidden} onChange={(v) => (v ? api.buddy.show() : api.buddy.hide())} />
        <div className="py-3">
          <button type="button" className="btn-outline" onClick={() => api.buddy.preview()}>👋 Say hello on the desktop</button>
        </div>
      </Section>
    </div>
  );
}
