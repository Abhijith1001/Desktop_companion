import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useChat, useSettings, useToasts, useBookmarks } from '../stores';
import { navigate } from '../hooks/useRoute';
import { Modal, BuddyPreview } from '../components/ui';
import CaptureCard from '../features/capture/CaptureCard';
import { shortcutLabel } from '../features/capture/ShortcutInput';

const TEXT_TYPES = ['text/plain', 'text/html', 'text/uri-list'];

function htmlToText(html) {
  try { return new DOMParser().parseFromString(html, 'text/html').body.textContent || ''; } catch { return ''; }
}

function useAiStatus() {
  const [ai, setAi] = useState(null);
  useEffect(() => { api.ai.status().then(setAi).catch(() => setAi({ configured: false })); }, []);
  return ai;
}

function Message({ m, aiConfigured }) {
  if (m.role === 'capture') return <CaptureCard message={m} aiConfigured={aiConfigured} />;
  const mine = m.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-xl whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm ${mine
        ? 'rounded-br-md bg-brand-500 text-stone-950'
        : m.error ? 'rounded-bl-md bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' : 'rounded-bl-md bg-white shadow-sm dark:bg-stone-800'}`}>
        {m.text}
        {m.results?.length > 0 && (
          <ul className="mt-2 space-y-1">
            {m.results.map((b) => (
              <li key={b.id}>
                <button type="button" className="text-left font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={() => navigate(`/bookmarks/${b.id}`)}>
                  🔖 {b.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        {m.role === 'assistant' && <span className="mt-1.5 block text-[11px] text-stone-400">☁ Answered by {m.model || 'the AI service'}</span>}
      </div>
    </div>
  );
}

function BookmarkPicker({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => api.bookmarks.list({ q: q || undefined, limit: 20 }).then((r) => setItems(r.items)).catch(() => setItems([])), 150);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Modal title="Reference a bookmark" onClose={onClose}>
      <input className="input mb-3" placeholder="Search bookmarks…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bookmarks" />
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {items.map((b) => (
          <li key={b.id}>
            <button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-stone-100 dark:hover:bg-stone-800" onClick={() => onPick(b)}>
              <span className="block text-sm font-semibold">{b.isFavorite ? '★ ' : ''}{b.title}</span>
              <span className="block truncate text-xs text-stone-500">{b.text.slice(0, 140)}</span>
            </button>
          </li>
        ))}
        {!items.length && <li className="py-6 text-center text-sm text-stone-500">{q ? 'No matches' : 'No bookmarks yet'}</li>}
      </ul>
    </Modal>
  );
}

function ConsentDialog({ chars, items, onAnswer }) {
  return (
    <Modal title="Send to the AI service?" onClose={() => onAnswer(null)}>
      <p className="text-sm">
        Your message{items ? ` and ${items} attached text${items > 1 ? 's' : ''}` : ''} ({chars.toLocaleString()} characters) will be sent to
        <strong> Anthropic</strong> over the internet to get an answer. Nothing else from your computer is sent.
      </p>
      <p className="mt-2 text-xs text-stone-500">Bookmarks stay on this computer either way. Avoid sending passwords or personal data.</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => onAnswer(null)}>Don’t send</button>
        <button type="button" className="btn-outline" onClick={() => onAnswer('session')}>Allow for this session</button>
        <button type="button" className="btn-primary" onClick={() => onAnswer('once')}>Send once</button>
      </div>
    </Modal>
  );
}

export default function ChatPage() {
  const chat = useChat();
  const { messages, context, draft, pending } = chat;
  const settings = useSettings((s) => s.settings);
  const toast = useToasts((s) => s.push);
  const recentVersion = useBookmarks((s) => s.version);
  const ai = useAiStatus();
  const [drag, setDrag] = useState(null); // 'text' | 'other' | null
  const [inspecting, setInspecting] = useState(false);
  const [capturing, setCapturing] = useState(null);
  const [picker, setPicker] = useState(false);
  const [consent, setConsent] = useState(null);
  const [recent, setRecent] = useState([]);
  const dragDepth = useRef(0);
  const endRef = useRef(null);
  const cap = settings.capture;

  useEffect(() => { chat.pullPending(); }, []); // a shortcut capture may be waiting
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length, pending]);
  useEffect(() => { api.bookmarks.list({ limit: 5 }).then((r) => setRecent(r.items)).catch(() => {}); }, [recentVersion]);

  // ---- Drag and drop from other apps
  const kindOf = (e) => (TEXT_TYPES.some((t) => e.dataTransfer.types.includes(t)) ? 'text' : 'other');
  const onDragEnter = (e) => { e.preventDefault(); dragDepth.current++; setDrag(kindOf(e)); };
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = kindOf(e) === 'text' ? 'copy' : 'none'; };
  const onDragLeave = () => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDrag(null); } };
  async function onDrop(e) {
    e.preventDefault();
    dragDepth.current = 0;
    setDrag(null);
    const dt = e.dataTransfer;
    const uri = (dt.getData('text/uri-list') || '').split('\n').find((l) => l && !l.startsWith('#'))?.trim();
    const text = dt.getData('text/plain') || htmlToText(dt.getData('text/html')) || uri || '';
    if (!text.trim()) { toast(dt.files.length ? 'Only text can be dropped here — files are not supported.' : 'Nothing readable was dropped.', 'error'); return; }
    setInspecting(true);
    try {
      const r = await api.capture.inspectDrop(text);
      // A dragged link carries its own URL, which beats the active-window guess.
      if (r.ok && uri && /^https?:\/\//i.test(uri)) { r.sourceUrl = uri; }
      chat.receiveCapture(r);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setInspecting(false);
    }
  }

  async function delayedCapture(kind) {
    setCapturing(kind);
    try {
      const r = await (kind === 'ocr' ? api.capture.ocr(3) : api.capture.selection(3));
      if (!r.ok && r.reason === 'ocr-off') chat.receiveCapture(r);
      // Successful results arrive through the "capture:new" event.
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setCapturing(null);
    }
  }

  // ---- Sending
  async function localAnswer(text) {
    try {
      const r = await api.bookmarks.list({ q: text, limit: 5 });
      chat.add({
        role: 'buddy',
        text: r.total
          ? `No AI service is set up, so here are your bookmarks matching “${text}”:`
          : 'No AI service is set up, and none of your bookmarks match that. You can add an Anthropic API key in Settings › AI assistant.',
        results: r.items,
      });
    } catch (err) { chat.add({ role: 'buddy', text: err.message, error: true }); }
  }

  async function ask(history) {
    chat.setPending(true);
    try {
      const r = await api.ai.ask({ history, context: context.map(({ key, ...c }) => c), consent: true });
      chat.add({ role: 'assistant', text: r.text + (r.truncated ? '\n\n(The answer was cut short.)' : ''), model: r.model });
    } catch (err) {
      chat.add({ role: 'buddy', text: err.message, error: true });
    } finally {
      chat.setPending(false);
    }
  }

  function send(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    chat.add({ role: 'user', text });
    chat.setDraft('');
    if (!ai?.configured) { localAnswer(text); return; }
    const history = [...useChat.getState().messages]
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-20)
      .map((m) => ({ role: m.role, text: m.text }));
    if (useChat.getState().aiConsent) { ask(history); return; }
    const chars = text.length + context.reduce((n, c) => n + c.text.length, 0);
    setConsent({ history, chars, items: context.length });
  }

  function answerConsent(choice) {
    const req = consent;
    setConsent(null);
    if (!choice) { chat.add({ role: 'buddy', text: 'Okay — that message was not sent anywhere.' }); return; }
    if (choice === 'session') chat.setAiConsent(true);
    ask(req.history);
  }

  const attachBookmark = (b) => {
    chat.attach({ key: `bm-${b.id}`, kind: 'bookmark', title: b.title, text: b.text, sourceApp: b.sourceApp, sourceUrl: b.sourceUrl, notes: b.notes });
    setPicker(false);
  };

  return (
    <div className="relative flex h-full flex-col" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-6 py-3 dark:border-stone-800">
        <h1 className="text-xl font-bold">Chat</h1>
        <span className={`chip ${ai?.configured ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' : 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-300'}`}
          title={ai?.configured ? 'Messages are only sent after you agree' : 'Chat works offline; questions search your bookmarks'}>
          {ai?.configured ? `AI on · asks before sending${chat.aiConsent ? ' (allowed this session)' : ''}` : 'AI off · local only'}
        </span>
        {cap.ocrEnabled && <span className="chip bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" title="Screen reading is allowed, but only runs when you press its shortcut">👁 Screen reading allowed</span>}
        <span className="ml-auto flex gap-1.5">
          <button type="button" className="btn-outline" disabled={!!capturing} onClick={() => delayedCapture('selection')}
            title={`Switch to another app within 3 seconds; its selected text will be captured. Shortcut: ${shortcutLabel(cap.shortcut)}`}>
            {capturing === 'selection' ? '⏳ Capturing…' : '✂ Capture in 3 s'}
          </button>
          {cap.ocrEnabled && (
            <button type="button" className="btn-outline" disabled={!!capturing} onClick={() => delayedCapture('ocr')} title="Switch to another window within 3 seconds; its visible text will be read once with OCR">
              {capturing === 'ocr' ? '⏳ Reading…' : '👁 Read window in 3 s'}
            </button>
          )}
          <button type="button" className="btn-ghost px-2" onClick={() => navigate('/bookmarks')} aria-label="Open bookmarks" title="Bookmarks">🔖</button>
          {messages.length > 0 && <button type="button" className="btn-ghost px-2" onClick={() => chat.clear()} aria-label="Clear chat" title="Clear chat">🧹</button>}
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="mx-auto mt-6 max-w-lg text-center">
            <BuddyPreview id={settings.character} state="idle" size={0.6} className="mx-auto" />
            <h2 className="mt-2 text-lg font-bold">Save text from any app</h2>
            <p className="mt-1 text-sm text-stone-500">
              Select text in another app and press <kbd className="rounded bg-stone-200 px-1.5 py-0.5 text-xs font-semibold dark:bg-stone-800">{shortcutLabel(cap.shortcut)}</kbd>,
              or drag a selection onto this window. You’ll see a preview before anything is saved.
            </p>
            {recent.length > 0 && (
              <div className="mt-6 text-left">
                <h3 className="label">Recently saved</h3>
                <ul className="card divide-y divide-stone-100 dark:divide-stone-800">
                  {recent.map((b) => (
                    <li key={b.id} className="flex items-center gap-2 px-3 py-2">
                      <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:underline" onClick={() => navigate(`/bookmarks/${b.id}`)}>
                        {b.isFavorite ? '★ ' : ''}{b.title}
                      </button>
                      <button type="button" className="btn-ghost shrink-0 py-0.5 text-xs" onClick={() => attachBookmark(b)}>📎 Use in chat</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {messages.map((m) => <Message key={m.id} m={m} aiConfigured={!!ai?.configured} />)}
        {inspecting && <p className="text-sm text-stone-500">Reading the dropped text…</p>}
        {pending && <p className="text-sm text-stone-500" role="status">✨ Thinking…</p>}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="border-t border-stone-200 px-6 py-3 dark:border-stone-800">
        {context.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Attached to your next question">
            {context.map((c) => (
              <span key={c.key} className="chip max-w-xs bg-brand-100 text-brand-900 dark:bg-brand-900/40 dark:text-brand-100">
                <span className="truncate">{c.kind === 'bookmark' ? '🔖' : '📌'} {c.title || c.text.slice(0, 40)}</span>
                <button type="button" onClick={() => chat.detach(c.key)} aria-label={`Remove ${c.title || 'attachment'}`} className="font-bold">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button type="button" className="btn-ghost px-2" onClick={() => setPicker(true)} title="Reference a saved bookmark" aria-label="Reference a bookmark">📎</button>
          <textarea id="chat-input" rows={1} className="input max-h-40 min-h-10 resize-none" value={draft}
            placeholder={ai?.configured ? 'Ask about captured text or your bookmarks…' : 'Search your bookmarks… (no AI service set up)'}
            onChange={(e) => chat.setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
          <button type="submit" className="btn-primary" disabled={!draft.trim() || pending}>Send</button>
        </div>
      </form>

      {drag && (
        <div className={`pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-2xl border-4 border-dashed ${drag === 'text'
          ? 'border-brand-500 bg-brand-50/90 dark:bg-stone-900/90' : 'border-stone-400 bg-stone-100/90 dark:bg-stone-900/90'}`}>
          <p className="text-lg font-bold">{drag === 'text' ? '📥 Drop text to capture it' : 'Only text can be dropped here'}</p>
        </div>
      )}
      {picker && <BookmarkPicker onPick={attachBookmark} onClose={() => setPicker(false)} />}
      {consent && <ConsentDialog chars={consent.chars} items={consent.items} onAnswer={answerConsent} />}
    </div>
  );
}
