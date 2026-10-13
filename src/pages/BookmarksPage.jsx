import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { useBookmarks, useChat, useToasts } from '../stores';
import { navigate } from '../hooks/useRoute';
import { Modal } from '../components/ui';
import { METHOD_LABELS, parseTags } from '../features/capture/CaptureCard';

const PAGE = 50;
const RANGES = { any: null, today: 0, week: 7, month: 30, year: 365 };

function since(range) {
  const days = RANGES[range];
  if (days == null) return undefined;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const fmt = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

function ConfirmDelete({ bookmark, onConfirm, onClose }) {
  return (
    <Modal title="Delete bookmark?" onClose={onClose}>
      <p className="text-sm">“{bookmark.title}” and its notes will be permanently deleted. This cannot be undone.</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-danger" onClick={onConfirm}>Delete</button>
      </div>
    </Modal>
  );
}

function Detail({ id, onDeleted }) {
  const toast = useToasts((s) => s.push);
  const attach = useChat((s) => s.attach);
  const [b, setB] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const version = useBookmarks((s) => s.version);

  useEffect(() => {
    let live = true;
    api.bookmarks.get(id).then((x) => {
      if (!live) return;
      setB(x);
      setForm({ title: x.title, text: x.text, notes: x.notes, tags: x.tags.join(', '), sourceUrl: x.sourceUrl || '' });
    }).catch((err) => { if (live) { setB(null); toast(err.message, 'error'); navigate('/bookmarks'); } });
    return () => { live = false; };
  }, [id]);

  // Keep the favourite flag current if it was toggled from the list.
  useEffect(() => { if (b) api.bookmarks.get(id).then((x) => setB((cur) => cur && { ...cur, isFavorite: x.isFavorite })).catch(() => {}); }, [version]);

  if (!b || !form) return <div className="p-6 text-sm text-stone-500">Loading…</div>;

  const dirty = form.title !== b.title || form.text !== b.text || form.notes !== b.notes
    || form.tags !== b.tags.join(', ') || form.sourceUrl !== (b.sourceUrl || '');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setSaving(true);
    try {
      const u = await api.bookmarks.update(id, { title: form.title, text: form.text, notes: form.notes, tags: parseTags(form.tags), sourceUrl: form.sourceUrl.trim() || null });
      setB(u);
      setForm({ title: u.title, text: u.text, notes: u.notes, tags: u.tags.join(', '), sourceUrl: u.sourceUrl || '' });
      toast('Bookmark updated');
    } catch (err) { toast(err.message, 'error'); } finally { setSaving(false); }
  }

  async function remove() {
    try { await api.bookmarks.remove(id); toast('Bookmark deleted'); setConfirm(false); onDeleted(); } catch (err) { toast(err.message, 'error'); }
  }

  const act = (fn, ok) => async () => { try { await fn(); if (ok) toast(ok); } catch (err) { toast(err.message, 'error'); } };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost px-2 text-lg" aria-pressed={b.isFavorite} aria-label={b.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={act(async () => setB(await api.bookmarks.update(id, { isFavorite: !b.isFavorite })))}>{b.isFavorite ? '★' : '☆'}</button>
        <input className="input flex-1 text-base font-bold" value={form.title} onChange={set('title')} aria-label="Title" maxLength={300} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-outline" onClick={act(() => api.bookmarks.copy(id), 'Text copied')}>📋 Copy text</button>
        {b.sourceUrl && <button type="button" className="btn-outline" onClick={act(() => api.bookmarks.openSource(id))}>🔗 Open source</button>}
        <button type="button" className="btn-outline" onClick={() => {
          attach({ key: `bm-${b.id}`, kind: 'bookmark', title: b.title, text: b.text, sourceApp: b.sourceApp, sourceUrl: b.sourceUrl, notes: b.notes });
          navigate('/chat');
        }}>💬 Use in chat</button>
        <button type="button" className="btn-ghost ml-auto text-red-600" onClick={() => setConfirm(true)}>🗑 Delete</button>
      </div>

      <dl className="card grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 p-4 text-sm">
        <dt className="text-stone-500">Saved</dt><dd>{fmt(b.createdAt)}{b.updatedAt !== b.createdAt && <span className="text-stone-400"> · edited {fmt(b.updatedAt)}</span>}</dd>
        <dt className="text-stone-500">App</dt><dd>{b.sourceApp || <span className="text-stone-400">Unknown</span>}</dd>
        <dt className="text-stone-500">Window</dt><dd className="break-words">{b.sourceTitle || <span className="text-stone-400">Unknown</span>}</dd>
        <dt className="text-stone-500">Captured by</dt><dd>{METHOD_LABELS[b.captureMethod] || '—'}</dd>
      </dl>

      <div>
        <label className="label" htmlFor="bm-url">Source link</label>
        <input id="bm-url" className="input" value={form.sourceUrl} onChange={set('sourceUrl')} placeholder="No link — add one if you like (https://…)" />
      </div>
      <div>
        <label className="label" htmlFor="bm-text">Saved text</label>
        <textarea id="bm-text" className="input min-h-48 font-[inherit] leading-relaxed" value={form.text} onChange={set('text')} />
      </div>
      <div>
        <label className="label" htmlFor="bm-notes">Notes</label>
        <textarea id="bm-notes" className="input min-h-24" value={form.notes} onChange={set('notes')} placeholder="Why did you save this?" maxLength={10000} />
      </div>
      <div>
        <label className="label" htmlFor="bm-tags">Tags / categories</label>
        <input id="bm-tags" className="input" value={form.tags} onChange={set('tags')} placeholder="research, work" />
      </div>

      <div className="sticky bottom-0 flex justify-end gap-2 bg-stone-50/90 py-2 dark:bg-stone-950/90">
        {dirty && <button type="button" className="btn-ghost" onClick={() => setForm({ title: b.title, text: b.text, notes: b.notes, tags: b.tags.join(', '), sourceUrl: b.sourceUrl || '' })}>Discard changes</button>}
        <button type="button" className="btn-primary" disabled={!dirty || saving || !form.title.trim()} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>

      {confirm && <ConfirmDelete bookmark={b} onConfirm={remove} onClose={() => setConfirm(false)} />}
    </div>
  );
}

export default function BookmarksPage({ selectedId }) {
  const { facets, version, refresh } = useBookmarks();
  const toast = useToasts((s) => s.push);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [app, setApp] = useState('');
  const [tag, setTag] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [range, setRange] = useState('any');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);

  const filter = useMemo(() => ({
    q: debounced || undefined, app: app || undefined, tag: tag || undefined, favorite: favorite || undefined, from: since(range),
  }), [debounced, app, tag, favorite, range]);

  async function load(offset = 0) {
    setLoading(true);
    try {
      const r = await api.bookmarks.list({ ...filter, limit: PAGE, offset });
      setItems((cur) => (offset ? [...cur, ...r.items] : r.items));
      setTotal(r.total);
    } catch (err) { toast(err.message, 'error'); } finally { setLoading(false); }
  }
  useEffect(() => { load(0); }, [filter, version]);

  const filtered = !!(filter.q || app || tag || favorite || range !== 'any');
  const clearFilters = () => { setQ(''); setApp(''); setTag(''); setFavorite(false); setRange('any'); };

  return (
    <div className="flex h-full">
      <section className="flex w-96 shrink-0 flex-col border-r border-stone-200 dark:border-stone-800" aria-label="Bookmark list">
        <div className="space-y-2 border-b border-stone-200 p-4 dark:border-stone-800">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Bookmarks</h1>
            <button type="button" className="btn-ghost text-xs" onClick={() => navigate('/chat')}>+ Capture</button>
          </div>
          <input type="search" className="input" placeholder="Search titles, text and notes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bookmarks" />
          <div className="grid grid-cols-2 gap-2">
            <select className="input py-1.5" value={app} onChange={(e) => setApp(e.target.value)} aria-label="Filter by app">
              <option value="">All apps</option>
              {facets.apps.map((a) => <option key={a.app} value={a.app}>{a.app} ({a.count})</option>)}
            </select>
            <select className="input py-1.5" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
              <option value="">All tags</option>
              {facets.tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>)}
            </select>
            <select className="input py-1.5" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Filter by date">
              <option value="any">Any time</option><option value="today">Today</option><option value="week">Last 7 days</option>
              <option value="month">Last 30 days</option><option value="year">Last year</option>
            </select>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 text-sm">
              <input type="checkbox" className="accent-brand-500" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} /> ★ Favorites
            </label>
          </div>
          <p className="flex justify-between text-xs text-stone-500">
            <span>{loading ? 'Loading…' : `${total} bookmark${total === 1 ? '' : 's'}${filtered ? ' found' : ''}`}</span>
            {filtered && <button type="button" className="font-semibold hover:underline" onClick={clearFilters}>Clear filters</button>}
          </p>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {items.map((b) => (
            <li key={b.id}>
              <a href={`#/bookmarks/${b.id}`} aria-current={b.id === selectedId ? 'page' : undefined}
                className={`block border-b border-stone-100 px-4 py-3 dark:border-stone-800 ${b.id === selectedId ? 'bg-white dark:bg-stone-800' : 'hover:bg-stone-100 dark:hover:bg-stone-900'}`}>
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {b.isFavorite && <span className="text-brand-600" aria-label="Favorite">★</span>}
                  <span className="truncate">{b.title}</span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-stone-500">{b.text}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-stone-400">
                  {b.sourceApp && <span>{b.sourceApp} ·</span>}
                  <span>{new Date(b.createdAt).toLocaleDateString()}</span>
                  {b.tags.map((t) => <span key={t} className="chip bg-stone-100 px-1.5 py-0 text-stone-600 dark:bg-stone-800 dark:text-stone-300">{t}</span>)}
                </span>
              </a>
            </li>
          ))}
          {!loading && items.length === 0 && (
            <li className="p-8 text-center text-sm text-stone-500">
              {filtered ? 'No bookmarks match these filters.' : 'No bookmarks yet. Capture text from any app with the shortcut, or drag it into the chat.'}
            </li>
          )}
          {items.length < total && (
            <li className="p-3 text-center"><button type="button" className="btn-outline" disabled={loading} onClick={() => load(items.length)}>Load more</button></li>
          )}
        </ul>
      </section>
      <section className="min-w-0 flex-1 overflow-y-auto" aria-label="Bookmark details">
        {selectedId
          ? <Detail key={selectedId} id={selectedId} onDeleted={() => navigate('/bookmarks')} />
          : <p className="p-10 text-center text-sm text-stone-500">{facets.total ? 'Select a bookmark to view or edit it.' : ''}</p>}
      </section>
    </div>
  );
}
