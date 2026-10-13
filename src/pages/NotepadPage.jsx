import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useToasts } from '../stores';
import { navigate } from '../hooks/useRoute';
import { Modal } from '../components/ui';

const SAVE_DELAY_MS = 600;
const titleOf = (n) => n.title.trim() || n.body.trim().split('\n')[0].slice(0, 60) || 'Untitled note';

function Editor({ id, onSaved, onDeleted }) {
  const toast = useToasts((s) => s.push);
  const [note, setNote] = useState(null);
  const [state, setState] = useState('saved'); // saved | dirty | saving | error
  const [confirm, setConfirm] = useState(false);
  const timer = useRef(null);
  const latest = useRef(null);

  useEffect(() => {
    api.notes.get(id).then((n) => { setNote(n); latest.current = n; }).catch((err) => { toast(err.message, 'error'); navigate('/notepad'); });
  }, [id]);

  async function flush() {
    clearTimeout(timer.current);
    const n = latest.current;
    if (!n) return;
    setState('saving');
    try {
      const saved = await api.notes.update(id, { title: n.title, body: n.body });
      setState((s) => (latest.current === n ? 'saved' : s));
      onSaved(saved);
    } catch (err) {
      setState('error');
      toast(err.message, 'error');
    }
  }

  // Save any pending edit when switching notes or leaving the page.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); const n = latest.current; if (n) api.notes.update(id, { title: n.title, body: n.body }).catch(() => {}); } }, [id]);

  const change = (patch) => {
    const n = { ...latest.current, ...patch };
    latest.current = n;
    setNote(n);
    setState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; flush(); }, SAVE_DELAY_MS);
  };

  if (!note) return <p className="p-6 text-sm text-stone-500">Loading…</p>;

  const words = note.body.trim() ? note.body.trim().split(/\s+/).length : 0;
  const act = (fn, ok) => async () => { try { await fn(); if (ok) toast(ok); } catch (err) { toast(err.message, 'error'); } };

  return (
    <div className="flex h-full flex-col" onKeyDown={(e) => { if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); flush(); } }}>
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-6 py-3 dark:border-stone-800">
        <input className="input flex-1 border-transparent bg-transparent text-lg font-bold shadow-none dark:bg-transparent" placeholder="Untitled note"
          value={note.title} maxLength={300} onChange={(e) => change({ title: e.target.value })} aria-label="Note title" />
        <span className="text-xs text-stone-500" role="status">
          {{ saved: '✓ Saved', dirty: 'Editing…', saving: 'Saving…', error: '⚠ Not saved' }[state]}
        </span>
        <button type="button" className="btn-ghost" onClick={act(() => api.notes.copy(id), 'Note copied')} disabled={!note.body}>📋 Copy</button>
        <button type="button" className="btn-ghost" disabled={!note.body.trim()} onClick={act(async () => {
          await flush();
          const r = await api.bookmarks.create({ title: titleOf(note).slice(0, 300), text: note.body, sourceApp: 'Desktop Buddy Notepad', captureMethod: 'manual' });
          if (r.duplicate) throw new Error(`Already saved as “${r.duplicate.title}”`);
        }, 'Saved as a bookmark')}>🔖 Bookmark</button>
        <button type="button" className="btn-ghost text-red-600" onClick={() => setConfirm(true)}>🗑 Delete</button>
      </div>
      <textarea className="min-h-0 flex-1 resize-none bg-transparent px-6 py-4 font-mono text-sm leading-relaxed outline-none focus-visible:outline-none"
        value={note.body} onChange={(e) => change({ body: e.target.value })} placeholder="Start typing…" aria-label="Note text" autoFocus spellCheck />
      <div className="border-t border-stone-200 px-6 py-1.5 text-xs text-stone-500 dark:border-stone-800">
        {words} word{words === 1 ? '' : 's'} · {note.body.length.toLocaleString()} characters · Ctrl+S saves now (it also saves automatically)
      </div>
      {confirm && (
        <Modal title="Delete note?" onClose={() => setConfirm(false)}>
          <p className="text-sm">“{titleOf(note)}” will be permanently deleted.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
            <button type="button" className="btn-danger" onClick={act(async () => {
              clearTimeout(timer.current); timer.current = null; latest.current = null;
              await api.notes.remove(id); setConfirm(false); onDeleted();
            }, 'Note deleted')}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function NotepadPage({ selectedId }) {
  const toast = useToasts((s) => s.push);
  const [notes, setNotes] = useState([]);
  const [q, setQ] = useState('');

  const load = (query = q) => api.notes.list(query.trim() || undefined).then(setNotes).catch((err) => toast(err.message, 'error'));
  useEffect(() => { const t = setTimeout(() => load(q), 150); return () => clearTimeout(t); }, [q]);

  async function newNote() {
    try { const n = await api.notes.create({}); setQ(''); await load(''); navigate(`/notepad/${n.id}`); } catch (err) { toast(err.message, 'error'); }
  }

  return (
    <div className="flex h-full">
      <section className={`flex w-full shrink-0 flex-col border-r border-stone-200 md:w-64 lg:w-72 dark:border-stone-800 ${selectedId ? 'max-md:hidden' : ''}`} aria-label="Notes">
        <div className="space-y-2 border-b border-stone-200 p-4 dark:border-stone-800">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-[-0.01em]">Notepad</h1>
            <button type="button" className="btn-primary" onClick={newNote}>+ New</button>
          </div>
          <input type="search" className="input" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {notes.map((n) => (
            <li key={n.id}>
              <a href={`#/notepad/${n.id}`} aria-current={n.id === selectedId ? 'page' : undefined}
                className={`block border-b border-stone-100 px-4 py-2.5 dark:border-stone-800 ${n.id === selectedId ? 'bg-white dark:bg-stone-800' : 'hover:bg-stone-100 dark:hover:bg-stone-900'}`}>
                <span className="block truncate text-sm font-semibold">{titleOf(n)}</span>
                <span className="block truncate text-xs text-stone-500">{new Date(n.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </a>
            </li>
          ))}
          {!notes.length && <li className="p-6 text-center text-sm text-stone-500">{q ? 'No notes match.' : 'No notes yet.'}</li>}
        </ul>
      </section>
      <section className={`flex min-w-0 flex-1 flex-col ${selectedId ? '' : 'max-md:hidden'}`} aria-label="Note editor">
        {selectedId && <a href="#/notepad" className="sticky top-0 z-10 flex items-center gap-1 border-b border-stone-200 bg-stone-50/95 px-4 py-2 text-sm font-medium text-stone-600 backdrop-blur md:hidden dark:border-stone-800 dark:bg-stone-950/95 dark:text-stone-300">‹ All notes</a>}
        {selectedId
          ? <Editor key={selectedId} id={selectedId}
              onSaved={(n) => setNotes((list) => [n, ...list.filter((x) => x.id !== n.id)])}
              onDeleted={() => { load(); navigate('/notepad'); }} />
          : (
            <div className="p-10 text-center text-sm text-stone-500">
              <p>Select a note, or create a new one.</p>
              <button type="button" className="btn-outline mt-3" onClick={newNote}>+ New note</button>
            </div>
          )}
      </section>
    </div>
  );
}
