import { useState } from 'react';
import { api } from '../../services/api';
import { useChat, useToasts } from '../../stores';
import { navigate } from '../../hooks/useRoute';

export const METHOD_LABELS = {
  uia: 'Selection (accessibility)',
  clipboard: 'Selection (copied)',
  ocr: 'Screen text (OCR)',
  drop: 'Dropped',
  manual: 'Typed',
};

export const defaultTitle = (text) => {
  const line = text.split('\n').find((l) => l.trim()) || 'Untitled';
  return line.trim().length > 80 ? `${line.trim().slice(0, 77)}…` : line.trim();
};

export const parseTags = (s) => s.split(',').map((t) => t.trim()).filter(Boolean);

// Preview of captured or dropped text. Nothing is stored until "Save bookmark".
export default function CaptureCard({ message, aiConfigured }) {
  const { capture: c, status } = message;
  const { patch, attach, setDraft } = useChat();
  const toast = useToasts((s) => s.push);
  const [title, setTitle] = useState(() => defaultTitle(c.text));
  const [sourceUrl, setSourceUrl] = useState(c.sourceUrl || '');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [showSource, setShowSource] = useState(!!c.sourceGuessed);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState(null);
  const long = c.text.length > 600;

  async function save(allowDuplicate = false) {
    setSaving(true);
    try {
      const r = await api.bookmarks.create({
        title, text: c.text, sourceApp: c.sourceApp, sourceTitle: c.sourceTitle, sourceUrl: sourceUrl.trim() || null,
        captureMethod: c.method, notes, tags: parseTags(tags),
      }, { allowDuplicate });
      if (r.duplicate) { setDuplicate(r.duplicate); return; }
      patch(message.id, { status: 'saved', bookmarkId: r.bookmark.id, savedTitle: r.bookmark.title });
      toast('Bookmark saved');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function askAi() {
    attach({ key: `cap-${message.id}`, kind: 'captured', title, text: c.text, sourceApp: c.sourceApp, sourceUrl: sourceUrl || null, notes });
    setDraft('Summarize this and list the key points.');
    document.getElementById('chat-input')?.focus();
  }

  if (status === 'cancelled') {
    return <p className="text-xs italic text-stone-400">Capture discarded.</p>;
  }

  return (
    <article className="card w-full max-w-xl overflow-hidden" aria-label="Captured text preview">
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-4 py-2.5 dark:border-stone-800">
        <span aria-hidden="true">📌</span>
        <span className="text-sm font-bold">Captured text</span>
        <span className="chip bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">{METHOD_LABELS[c.method] || c.method}</span>
        <span className="ml-auto text-xs text-stone-500">{c.text.length.toLocaleString()} chars</span>
      </header>

      {c.warnings?.length > 0 && status !== 'saved' && (
        <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          ⚠ This may contain {c.warnings.join(', ')}. Check it before saving — bookmarks are stored unencrypted on this computer.
        </p>
      )}

      <div className="px-4 py-3">
        <div className={`whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-3 text-sm leading-relaxed dark:bg-stone-950 ${expanded ? 'max-h-96 overflow-y-auto' : 'max-h-40 overflow-hidden'}`}>
          {expanded || !long ? c.text : `${c.text.slice(0, 600)}…`}
        </div>
        {long && (
          <button type="button" className="mt-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={() => setExpanded((x) => !x)}>
            {expanded ? 'Show less' : 'Show all'}
          </button>
        )}
        {c.truncated && <p className="mt-1 text-xs text-stone-500">Only the first 100,000 characters were kept.</p>}

        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-stone-500">App</dt><dd className="truncate">{c.sourceApp || <span className="text-stone-400">Unknown</span>}</dd>
          <dt className="text-stone-500">Window</dt><dd className="truncate" title={c.sourceTitle || ''}>{c.sourceTitle || <span className="text-stone-400">Unknown</span>}</dd>
          <dt className="text-stone-500">Link</dt>
          <dd className="truncate">{sourceUrl || <span className="text-stone-400">No link available</span>}</dd>
        </dl>
        {c.sourceGuessed && status !== 'saved' && (
          <p className="mt-1 text-xs text-stone-500">Source detected from the window that was active when you dropped the text — check it is right.</p>
        )}
      </div>

      {status === 'saved' ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-stone-100 bg-green-50 px-4 py-2.5 text-sm dark:border-stone-800 dark:bg-green-950/40">
          <span className="font-semibold text-green-800 dark:text-green-300">✓ Saved as “{message.savedTitle}”</span>
          <button type="button" className="btn-ghost ml-auto" onClick={() => navigate(`/bookmarks/${message.bookmarkId}`)}>Open in bookmarks</button>
          {aiConfigured && <button type="button" className="btn-ghost" onClick={askAi}>Ask AI</button>}
        </footer>
      ) : (
        <div className="space-y-3 border-t border-stone-100 px-4 py-3 dark:border-stone-800">
          <div>
            <label className="label" htmlFor={`t-${message.id}`}>Bookmark title</label>
            <input id={`t-${message.id}`} className="input" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {showSource && (
            <div>
              <label className="label" htmlFor={`u-${message.id}`}>Source link (optional)</label>
              <input id={`u-${message.id}`} className="input" value={sourceUrl} placeholder="https://…" onChange={(e) => setSourceUrl(e.target.value)} />
            </div>
          )}
          {showNotes && (
            <>
              <div>
                <label className="label" htmlFor={`n-${message.id}`}>Note</label>
                <textarea id={`n-${message.id}`} className="input min-h-20" value={notes} maxLength={10000} onChange={(e) => setNotes(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="label" htmlFor={`g-${message.id}`}>Tags</label>
                <input id={`g-${message.id}`} className="input" value={tags} placeholder="research, work" onChange={(e) => setTags(e.target.value)} />
              </div>
            </>
          )}
          {duplicate && (
            <div role="alert" className="rounded-lg bg-stone-100 p-2.5 text-xs dark:bg-stone-800">
              You already saved this text as “{duplicate.title}”.
              <span className="mt-1.5 flex gap-2">
                <button type="button" className="btn-outline py-1 text-xs" onClick={() => navigate(`/bookmarks/${duplicate.id}`)}>View it</button>
                <button type="button" className="btn-outline py-1 text-xs" onClick={() => { setDuplicate(null); save(true); }}>Save anyway</button>
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={saving || !title.trim()} onClick={() => save()}>
              {saving ? 'Saving…' : '🔖 Save bookmark'}
            </button>
            {!showNotes && <button type="button" className="btn-outline" onClick={() => setShowNotes(true)}>📝 Add note</button>}
            {!showSource && <button type="button" className="btn-outline" onClick={() => setShowSource(true)}>🔗 Edit link</button>}
            <button type="button" className="btn-outline" onClick={askAi} title={aiConfigured ? 'Attach this text to your next question' : 'Set up an AI service in Settings first'}>
              ✨ Ask AI about this
            </button>
            <button type="button" className="btn-ghost ml-auto" onClick={() => patch(message.id, { status: 'cancelled' })}>Cancel</button>
          </div>
        </div>
      )}
    </article>
  );
}
