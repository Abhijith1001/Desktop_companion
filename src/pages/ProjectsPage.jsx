import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useToasts } from '../stores';
import { navigate } from '../hooks/useRoute';
import { Modal, Field } from '../components/ui';
import Icon from '../components/Icon';

const COLORS = ['#e8994a', '#e5484d', '#d6409f', '#8e4ec6', '#3e63dd', '#0090ff', '#12a594', '#46a758', '#78716c'];
const STATUS = { active: 'Active', on_hold: 'On hold', done: 'Done' };
const STATUS_CLASS = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  on_hold: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  done: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
};
const FILE_ICON = { image: '🖼️', video: '🎬', audio: '🎵', pdf: '📕', doc: '📄', other: '📎' };
const SAVE_DELAY_MS = 600;

const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { dateStyle: 'medium' });
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`);
const noteTitle = (n) => n.title.trim() || n.body.trim().split('\n')[0].slice(0, 60) || 'Untitled note';

function useAct() {
  const toast = useToasts((s) => s.push);
  return (fn, ok) => async (...args) => { try { const r = await fn(...args); if (ok) toast(ok); return r; } catch (err) { toast(err.message, 'error'); return undefined; } };
}

function StatusChip({ status }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[status]}`}>{STATUS[status]}</span>;
}

function ProjectForm({ initial, onSubmit, onClose }) {
  const [form, setForm] = useState({ name: initial?.name ?? '', description: initial?.description ?? '', color: initial?.color ?? COLORS[0], status: initial?.status ?? 'active' });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Modal title={initial ? 'Edit project' : 'New project'} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) onSubmit(form); }}>
        <Field label="Name" htmlFor="project-name">
          <input id="project-name" className="input" value={form.name} maxLength={200} required onChange={(e) => set({ name: e.target.value })} placeholder="Website redesign" />
        </Field>
        <Field label="Description" htmlFor="project-desc">
          <textarea id="project-desc" className="input min-h-24" value={form.description} maxLength={5000} onChange={(e) => set({ description: e.target.value })} placeholder="What is this project about?" />
        </Field>
        <Field label="Status" htmlFor="project-status">
          <select id="project-status" className="input" value={form.status} onChange={(e) => set({ status: e.target.value })}>
            {Object.entries(STATUS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </Field>
        <div>
          <span className="label">Color</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
            {COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={form.color === c} aria-label={c} onClick={() => set({ color: c })}
                className={`h-7 w-7 rounded-full ring-offset-2 dark:ring-offset-stone-900 ${form.color === c ? 'ring-2 ring-stone-900 dark:ring-white' : ''}`} style={{ background: c }} />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!form.name.trim()}>{initial ? 'Save' : 'Create project'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---- Grid of all projects
function ProjectGrid() {
  const act = useAct();
  const [projects, setProjects] = useState(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => { act(api.projects.list)().then((l) => setProjects(l ?? [])); }, []);

  const create = act(async (form) => { const p = await api.projects.create(form); setCreating(false); navigate(`/projects/${p.id}`); }, 'Project created');
  const shown = (projects ?? []).filter((p) => !q.trim() || `${p.name} ${p.description}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-xl font-semibold tracking-[-0.01em]">Projects</h1>
        <input type="search" className="input w-full sm:w-64" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} strokeWidth={2.25} />New project</button>
      </div>

      {projects && !projects.length && (
        <div className="card p-10 text-center">
          <p className="text-sm text-stone-500">No projects yet. Create one to keep its tasks, files and notes together.</p>
          <button type="button" className="btn-outline mt-4" onClick={() => setCreating(true)}>+ New project</button>
        </div>
      )}
      {projects && !!projects.length && !shown.length && <p className="p-6 text-center text-sm text-stone-500">No projects match.</p>}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((p) => {
          const pct = p.counts.tasks ? Math.round((p.counts.done / p.counts.tasks) * 100) : 0;
          return (
            <li key={p.id}>
              <a href={`#/projects/${p.id}`} className="card flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md focus-visible:shadow-md">
                <span className="h-1.5" style={{ background: p.color }} aria-hidden="true" />
                <span className="flex flex-1 flex-col gap-2 p-4">
                  <span className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{p.name}</span>
                    <StatusChip status={p.status} />
                  </span>
                  <span className="line-clamp-2 min-h-10 text-sm text-stone-500 dark:text-stone-400">{p.description || 'No description'}</span>
                  <span className="mt-auto block">
                    <span className="mb-1 flex justify-between text-xs text-stone-500">
                      <span>{p.counts.done}/{p.counts.tasks} tasks</span><span className="tabular">{pct}%</span>
                    </span>
                    <span className="block h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: p.color }} />
                    </span>
                  </span>
                  <span className="flex gap-3 text-xs text-stone-500">
                    <span>📎 {p.counts.files} file{p.counts.files === 1 ? '' : 's'}</span>
                    <span>📝 {p.counts.notes} note{p.counts.notes === 1 ? '' : 's'}</span>
                    <span className="ml-auto">Updated {fmtDate(p.updatedAt)}</span>
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {creating && <ProjectForm onSubmit={create} onClose={() => setCreating(false)} />}
    </div>
  );
}

// ---- Tasks tab
function TasksTab({ project, reload }) {
  const act = useAct();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const add = act(async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    await api.projects.addTask(project.id, { title, dueDate: due || null });
    setTitle(''); setDue(''); reload();
  });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      <form className="flex flex-wrap gap-2" onSubmit={add}>
        <input className="input min-w-48 flex-1" placeholder="Add a task…" value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} aria-label="New task" />
        <input type="date" className="input w-auto" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
        <button type="submit" className="btn-primary" disabled={!title.trim()}>Add</button>
      </form>
      <ul className="card divide-y divide-stone-100 dark:divide-stone-800">
        {project.tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
            <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={t.done} aria-label={`Mark “${t.title}” ${t.done ? 'not done' : 'done'}`}
              onChange={act(async () => { await api.projects.updateTask(t.id, { done: !t.done }); reload(); })} />
            <span className={`min-w-0 flex-1 text-sm ${t.done ? 'text-stone-400 line-through' : ''}`}>{t.title}</span>
            {t.dueDate && <span className={`text-xs ${!t.done && t.dueDate < today ? 'font-semibold text-red-600' : 'text-stone-500'}`}>{fmtDate(`${t.dueDate}T00:00`)}</span>}
            <button type="button" className="btn-ghost px-2 text-stone-400 hover:text-red-600" aria-label={`Delete “${t.title}”`}
              onClick={act(async () => { await api.projects.removeTask(t.id); reload(); })}><Icon name="x" size={16} /></button>
          </li>
        ))}
        {!project.tasks.length && <li className="p-6 text-center text-sm text-stone-500">No tasks yet.</li>}
      </ul>
    </div>
  );
}

// ---- Files tab
function Thumb({ file }) {
  const [src, setSrc] = useState(null);
  useEffect(() => { if (file.kind === 'image') api.projects.preview(file.id).then(setSrc).catch(() => {}); }, [file.id]);
  return src
    ? <img src={src} alt="" className="h-full w-full object-cover" />
    : <span className="text-4xl" aria-hidden="true">{FILE_ICON[file.kind]}</span>;
}

function FilesTab({ project, reload }) {
  const act = useAct();
  const toast = useToasts((s) => s.push);
  const [confirm, setConfirm] = useState(null);
  const add = act(async () => {
    const { added, skipped } = await api.projects.addFiles(project.id);
    skipped.forEach((s) => toast(`${s.name} ${s.reason}`, 'error'));
    if (added.length) { toast(`Added ${added.length} file${added.length === 1 ? '' : 's'}`); reload(); }
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">Documents, PDFs, images, videos — files are copied into the project.</p>
        <button type="button" className="btn-primary" onClick={add}><Icon name="plus" size={16} strokeWidth={2.25} />Upload files</button>
      </div>
      {!project.files.length && <div className="card p-8 text-center text-sm text-stone-500">No files yet.</div>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {project.files.map((f) => (
          <li key={f.id} className="card group overflow-hidden">
            <button type="button" className="grid h-28 w-full place-items-center bg-stone-100 dark:bg-stone-800" title="Open" onClick={act(() => api.projects.openFile(f.id))}>
              <Thumb file={f} />
            </button>
            <div className="p-2.5">
              <p className="truncate text-sm font-medium" title={f.name}>{f.name}</p>
              <p className="text-xs text-stone-500">{fmtSize(f.size)} · {fmtDate(f.createdAt)}</p>
              <div className="mt-1.5 flex gap-1">
                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={act(() => api.projects.openFile(f.id))}>Open</button>
                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={act(() => api.projects.showFile(f.id))}>Show in folder</button>
                <button type="button" className="btn-ghost ml-auto px-2 py-1 text-xs text-red-600" onClick={() => setConfirm(f)}>Delete</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {confirm && (
        <Modal title="Delete file?" onClose={() => setConfirm(null)}>
          <p className="text-sm">“{confirm.name}” will be removed from this project. The original file you uploaded is not affected.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className="btn-danger" onClick={act(async () => { await api.projects.removeFile(confirm.id); setConfirm(null); reload(); }, 'File deleted')}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---- Notes tab: list on the left, autosaving editor on the right
function NoteEditor({ note, onSaved, onDelete }) {
  const toast = useToasts((s) => s.push);
  const [draft, setDraft] = useState(note);
  const [state, setState] = useState('saved');
  const timer = useRef(null);
  const latest = useRef(note);

  const save = async () => {
    clearTimeout(timer.current); timer.current = null;
    const n = latest.current;
    setState('saving');
    try { onSaved(await api.projects.updateNote(n.id, { title: n.title, body: n.body })); setState((s) => (latest.current === n ? 'saved' : s)); } catch (err) { setState('error'); toast(err.message, 'error'); }
  };
  // Flush a pending edit when switching notes or leaving the page.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); const n = latest.current; api.projects.updateNote(n.id, { title: n.title, body: n.body }).catch(() => {}); } }, [note.id]);

  const change = (patch) => {
    const n = { ...latest.current, ...patch };
    latest.current = n; setDraft(n); setState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY_MS);
  };

  return (
    <div className="card flex min-h-80 flex-1 flex-col" onKeyDown={(e) => { if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } }}>
      <div className="flex items-center gap-2 border-b border-stone-200 px-4 py-2 dark:border-stone-800">
        <input className="input flex-1 border-transparent bg-transparent font-semibold shadow-none dark:bg-transparent" placeholder="Untitled note" value={draft.title} maxLength={300}
          onChange={(e) => change({ title: e.target.value })} aria-label="Note title" />
        <span className="text-xs text-stone-500" role="status">{{ saved: '✓ Saved', dirty: 'Editing…', saving: 'Saving…', error: '⚠ Not saved' }[state]}</span>
        <button type="button" className="btn-ghost text-red-600" onClick={() => { clearTimeout(timer.current); timer.current = null; onDelete(); }}>Delete</button>
      </div>
      <textarea className="min-h-64 flex-1 resize-none bg-transparent px-4 py-3 text-sm leading-relaxed outline-none" value={draft.body} placeholder="Write your note…"
        onChange={(e) => change({ body: e.target.value })} aria-label="Note text" spellCheck />
    </div>
  );
}

function NotesTab({ project, reload }) {
  const act = useAct();
  const [selected, setSelected] = useState(project.notes[0]?.id ?? null);
  const [notes, setNotes] = useState(project.notes);
  useEffect(() => setNotes(project.notes), [project.notes]);
  const current = notes.find((n) => n.id === selected);

  const add = act(async () => { const n = await api.projects.addNote(project.id, {}); setNotes((l) => [n, ...l]); setSelected(n.id); });
  const remove = act(async () => { await api.projects.removeNote(selected); setSelected(null); reload(); }, 'Note deleted');

  return (
    <div className="flex flex-col gap-3 md:flex-row">
      <div className="card shrink-0 md:w-64">
        <div className="flex items-center justify-between border-b border-stone-200 px-3 py-2 dark:border-stone-800">
          <span className="text-sm font-semibold">Notes</span>
          <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={add}>+ New</button>
        </div>
        <ul className="max-h-96 overflow-y-auto">
          {notes.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => setSelected(n.id)} aria-current={n.id === selected ? 'true' : undefined}
                className={`block w-full border-b border-stone-100 px-3 py-2 text-left dark:border-stone-800 ${n.id === selected ? 'bg-stone-100 dark:bg-stone-800' : 'hover:bg-stone-50 dark:hover:bg-stone-900'}`}>
                <span className="block truncate text-sm font-medium">{noteTitle(n)}</span>
                <span className="block text-xs text-stone-500">{fmtDate(n.updatedAt)}</span>
              </button>
            </li>
          ))}
          {!notes.length && <li className="p-4 text-center text-sm text-stone-500">No notes yet.</li>}
        </ul>
      </div>
      {current
        ? <NoteEditor key={current.id} note={current} onDelete={remove} onSaved={(n) => setNotes((l) => l.map((x) => (x.id === n.id ? n : x)))} />
        : <div className="card flex flex-1 items-center justify-center p-10 text-sm text-stone-500">Select a note, or create a new one.</div>}
    </div>
  );
}

// ---- One project
function ProjectDetail({ id }) {
  const act = useAct();
  const [project, setProject] = useState(null);
  const [tab, setTab] = useState('tasks');
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const reload = () => api.projects.detail(id).then(setProject).catch((err) => { useToasts.getState().push(err.message, 'error'); navigate('/projects'); });
  useEffect(() => { reload(); }, [id]);

  if (!project) return <p className="p-6 text-sm text-stone-500">Loading…</p>;

  const pct = project.counts.tasks ? Math.round((project.counts.done / project.counts.tasks) * 100) : 0;
  const tabs = [['tasks', `Tasks (${project.tasks.length})`], ['files', `Files (${project.files.length})`], ['notes', `Notes (${project.notes.length})`]];
  const save = act(async (form) => { await api.projects.update(id, form); setEditing(false); reload(); }, 'Project saved');

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <a href="#/projects" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">‹ All projects</a>
      <header className="card mb-5 overflow-hidden">
        <div className="h-2" style={{ background: project.color }} aria-hidden="true" />
        <div className="p-5">
          <div className="flex flex-wrap items-start gap-3">
            <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-[-0.01em]">{project.name}</h1>
            <StatusChip status={project.status} />
            <button type="button" className="btn-outline" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" className="btn-ghost text-red-600" onClick={() => setConfirm(true)}>Delete</button>
          </div>
          {project.description && <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm text-stone-600 dark:text-stone-300">{project.description}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-stone-500">
            <span className="flex items-center gap-2">
              <span className="block h-1.5 w-32 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: project.color }} />
              </span>
              {pct}% complete
            </span>
            <span>Created {fmtDate(project.createdAt)}</span>
            <span>Updated {fmtDate(project.updatedAt)}</span>
          </div>
        </div>
      </header>

      <div role="tablist" aria-label="Project sections" className="mb-4 flex gap-1 border-b border-stone-200 dark:border-stone-800">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-brand-500 text-stone-900 dark:text-white' : 'border-transparent text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'}`}>
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'tasks' && <TasksTab project={project} reload={reload} />}
        {tab === 'files' && <FilesTab project={project} reload={reload} />}
        {tab === 'notes' && <NotesTab project={project} reload={reload} />}
      </div>

      {editing && <ProjectForm initial={project} onSubmit={save} onClose={() => setEditing(false)} />}
      {confirm && (
        <Modal title="Delete project?" onClose={() => setConfirm(false)}>
          <p className="text-sm">“{project.name}” and all of its tasks, notes and uploaded files will be permanently deleted.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
            <button type="button" className="btn-danger" onClick={act(async () => { await api.projects.remove(id); navigate('/projects'); }, 'Project deleted')}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function ProjectsPage({ selectedId }) {
  return selectedId ? <ProjectDetail key={selectedId} id={selectedId} /> : <ProjectGrid />;
}
