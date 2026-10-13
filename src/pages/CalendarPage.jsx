import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { useTasks, useToasts } from '../stores';
import { navigate } from '../hooks/useRoute';
import { Modal } from '../components/ui';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const keyOf = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const DOT = { HIGH: 'bg-red-500', MEDIUM: 'bg-amber-500', LOW: 'bg-stone-400' };

export default function CalendarPage() {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(() => keyOf(new Date()));
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState('url'); // 'url' | 'file'
  const [feedUrl, setFeedUrl] = useState('');
  const [icsFileContent, setIcsFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [leadMinutes, setLeadMinutes] = useState(10);
  const [importing, setImporting] = useState(false);

  const fileInputRef = useRef(null);
  const tasksVersion = useTasks((s) => s.tasks);
  const toast = useToasts((s) => s.push);

  // 6-week grid starting on Monday.
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((start.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);

  const loadRange = () => {
    const from = new Date(days[0]);
    const to = new Date(days[41]); to.setHours(23, 59, 59, 999);
    api.tasks.calendar(from.toISOString(), to.toISOString())
      .then((r) => setItems(r))
      .catch(() => {});
  };

  useEffect(() => {
    loadRange();
  }, [days, tasksVersion]);

  const byDay = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      const k = keyOf(new Date(it.at));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return m;
  }, [items]);

  const shift = (n) => setMonth((m) => { const d = new Date(m); d.setMonth(d.getMonth() + n); return d; });
  const todayKey = keyOf(new Date());
  const selectedItems = byDay.get(selected) || [];
  const selectedDate = days.find((d) => keyOf(d) === selected);

  async function handleImportSubmit(e) {
    e.preventDefault();
    setImporting(true);
    try {
      let res;
      if (importTab === 'url') {
        if (!feedUrl.trim()) throw new Error('Please enter a calendar feed URL');
        res = await api.calendar.fetchAndImport({
          url: feedUrl.trim(),
          defaultLeadMinutes: Number(leadMinutes),
          category: 'Meeting',
        });
      } else {
        if (!icsFileContent) throw new Error('Please select an .ics calendar file');
        res = await api.calendar.importIcs({
          icsText: icsFileContent,
          defaultLeadMinutes: Number(leadMinutes),
          category: 'Meeting',
        });
      }

      toast(`Imported ${res.imported} meetings (${res.skipped} skipped or already added) ✅`);
      try {
        await api.buddy.speak(
          res.imported > 0
            ? `I imported ${res.imported} meetings! I'll remind you ${leadMinutes} min before each one 🗓️`
            : `All meetings were already up to date!`
        );
      } catch { /* buddy speech optional */ }

      setImportOpen(false);
      setFeedUrl('');
      setIcsFileContent('');
      setFileName('');
      useTasks.getState().load();
      loadRange();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setImporting(false);
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setIcsFileContent(String(ev.target?.result || ''));
    };
    reader.readAsText(file);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <div className="min-w-0 p-4 sm:p-6 lg:flex-1 lg:overflow-y-auto">
        <header className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="page-title mr-auto">{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h1>
          <button type="button" className="btn-outline flex items-center gap-1.5" onClick={() => setImportOpen(true)}>
            <span>📅</span>
            <span>Import Calendar</span>
          </button>
          <div className="flex items-center gap-1">
            <button type="button" className="btn-outline" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
            <button type="button" className="btn-outline" onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setMonth(d); setSelected(todayKey); }}>Today</button>
            <button type="button" className="btn-outline" onClick={() => shift(1)} aria-label="Next month">›</button>
          </div>
        </header>

        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-stone-200 text-center text-xs font-semibold uppercase text-stone-500 dark:border-stone-800">
            {DAY_NAMES.map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7" role="grid">
            {days.map((d) => {
              const k = keyOf(d);
              const list = byDay.get(k) || [];
              const inMonth = d.getMonth() === month.getMonth();
              return (
                <button key={k} type="button" role="gridcell" aria-selected={selected === k} onClick={() => setSelected(k)}
                  aria-label={`${d.toDateString()}, ${list.length} tasks`}
                  className={`flex min-h-16 flex-col gap-1 sm:min-h-24 border-b border-r border-stone-100 p-1.5 text-left align-top dark:border-stone-800 ${selected === k ? 'bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-stone-50 dark:hover:bg-stone-800/40'} ${inMonth ? '' : 'opacity-40'}`}>
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${k === todayKey ? 'bg-brand-500 text-stone-950' : ''}`}>{d.getDate()}</span>
                  {list.slice(0, 3).map((it, i) => (
                    <span key={i} className={`flex items-center gap-1 truncate text-[11px] ${it.status === 'COMPLETED' ? 'text-stone-400 line-through' : ''}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[it.priority]}`} />
                      {it.category === 'Meeting' && <span className="text-[10px]">📞</span>}
                      <span className="truncate">{it.title}</span>
                    </span>
                  ))}
                  {list.length > 3 && <span className="text-[11px] text-stone-500">+{list.length - 3} more</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="shrink-0 border-t border-stone-200 bg-white p-5 lg:w-84 lg:overflow-y-auto lg:border-l lg:border-t-0 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="mb-3 text-lg font-bold">{selectedDate?.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        {selectedItems.length === 0 && <p className="text-sm text-stone-500">Nothing scheduled.</p>}
        <ul className="space-y-2">
          {selectedItems.map((it, i) => (
            <li key={i} className="group relative">
              <div className="flex w-full flex-col gap-1 rounded-xl border border-stone-200 p-2.5 text-left text-sm hover:border-brand-400 dark:border-stone-800 transition-colors">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${DOT[it.priority]}`} />
                  <span className="text-xs font-mono text-stone-500">
                    {new Date(it.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  {it.category === 'Meeting' && (
                    <span className="rounded bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 px-1.5 py-0.5 text-[10px] font-semibold">
                      Meeting
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => navigate(`/tasks/${it.taskId}`)}
                  className={`truncate text-left font-medium hover:text-brand-500 ${it.status === 'COMPLETED' ? 'text-stone-400 line-through' : ''}`}>
                  {it.title}
                </button>
                {it.link && (
                  <div className="mt-1 flex items-center gap-1.5 pt-1 border-t border-stone-100 dark:border-stone-800">
                    <span className="text-xs">🎥</span>
                    <a href={it.link} target="_blank" rel="noreferrer"
                      className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline truncate">
                      Join call / meeting link ↗
                    </a>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-primary mt-4 w-full" onClick={() => navigate('/tasks/new')}>+ New task</button>
      </aside>

      {/* Calendar Import Modal */}
      {importOpen && (
        <Modal title="Import Calendar (Google Calendar & Outlook)" onClose={() => setImportOpen(false)} wide>
          <div className="space-y-4">
            <p className="text-sm text-stone-600 dark:text-stone-300">
              Import meetings so your desktop buddy sits with you and gives you an alert before each meeting begins.
            </p>

            {/* Tab switch */}
            <div className="flex border-b border-stone-200 dark:border-stone-700">
              <button type="button"
                className={`py-2 px-4 text-sm font-semibold border-b-2 transition-colors ${importTab === 'url' ? 'border-brand-500 text-brand-600 dark:text-brand-400' : 'border-transparent text-stone-500 hover:text-stone-700'}`}
                onClick={() => setImportTab('url')}>
                🔗 iCal / Webcal URL
              </button>
              <button type="button"
                className={`py-2 px-4 text-sm font-semibold border-b-2 transition-colors ${importTab === 'file' ? 'border-brand-500 text-brand-600 dark:text-brand-400' : 'border-transparent text-stone-500 hover:text-stone-700'}`}
                onClick={() => setImportTab('file')}>
                📁 Upload .ics File
              </button>
            </div>

            <form onSubmit={handleImportSubmit} className="space-y-4">
              {importTab === 'url' ? (
                <div>
                  <label className="label" htmlFor="feed-url">Calendar Feed URL (.ics / webcal)</label>
                  <input id="feed-url" type="url"
                    className="input w-full"
                    placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                    value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)}
                    required />

                  <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50/70 p-3 text-xs text-stone-600 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-400 space-y-1.5">
                    <p className="font-semibold text-stone-700 dark:text-stone-300">How to get your calendar link:</p>
                    <p>• <strong>Google Calendar:</strong> Calendar Settings → Click calendar name → Scroll to <em>"Secret address in iCal format"</em> → Copy link.</p>
                    <p>• <strong>Outlook:</strong> Outlook Web → Settings ⚙ → Calendar → Shared calendars → <em>"Publish a calendar"</em> → Copy the <strong>ICS link</strong>.</p>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="label">Select .ics file</label>
                  <div className="border-2 border-dashed border-stone-300 dark:border-stone-700 rounded-xl p-6 text-center cursor-pointer hover:border-brand-400 transition-colors"
                    onClick={() => fileInputRef.current?.click()}>
                    <span className="text-3xl block mb-2">📁</span>
                    <p className="text-sm font-semibold">{fileName || 'Click to browse for a .ics calendar file'}</p>
                    <p className="text-xs text-stone-400 mt-1">Exported from Google Calendar, Outlook, Apple Calendar, etc.</p>
                    <input ref={fileInputRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={handleFileChange} />
                  </div>
                </div>
              )}

              {/* Lead minutes setting */}
              <div>
                <label className="label" htmlFor="lead-mins">Remind me before each meeting</label>
                <select id="lead-mins" className="input w-full" value={leadMinutes} onChange={(e) => setLeadMinutes(Number(e.target.value))}>
                  <option value={0}>At start time (0 min)</option>
                  <option value={5}>5 minutes before</option>
                  <option value={10}>10 minutes before (recommended)</option>
                  <option value={15}>15 minutes before</option>
                  <option value={30}>30 minutes before</option>
                </select>
                <p className="mt-1 text-xs text-stone-400">The buddy will pop up and notify you before the call starts.</p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-stone-200 dark:border-stone-800">
                <button type="button" className="btn-ghost" onClick={() => setImportOpen(false)}>Cancel</button>
                <button type="submit" disabled={importing || (importTab === 'file' && !icsFileContent)} className="btn-primary">
                  {importing ? 'Importing…' : 'Import Meetings'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}
