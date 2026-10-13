import { create } from 'zustand';
import { api } from '../services/api';

export const useTasks = create((set, get) => ({
  tasks: [],
  loaded: false,
  async load() {
    set({ tasks: await api.tasks.list(), loaded: true });
  },
  async run(action) {
    try {
      const result = await action();
      await get().load();
      return result;
    } catch (err) {
      useToasts.getState().push(err.message, 'error');
      throw err;
    }
  },
}));

export const useSettings = create((set) => ({
  settings: null,
  async load() { set({ settings: await api.settings.get() }); },
  async update(patch) {
    try {
      set({ settings: await api.settings.update(patch) });
    } catch (err) {
      useToasts.getState().push(err.message, 'error');
    }
  },
  receive(settings) { set({ settings }); },
}));

export const useSync = create((set) => ({
  status: null,
  async load() { set({ status: await api.sync.status() }); },
  receive(status) { set({ status }); },
}));

let toastId = 0;
export const useToasts = create((set) => ({
  toasts: [],
  push(text, kind = 'info') {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' || kind === 'success' ? 6000 : 3000);
  },
  dismiss(id) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },
}));

// Bookmark filter facets + a version counter that list views watch to reload.
export const useBookmarks = create((set) => ({
  facets: { apps: [], tags: [], total: 0 },
  version: 0,
  async refresh() {
    try { set((s) => ({ version: s.version + 1 })); set({ facets: await api.bookmarks.facets() }); } catch { /* shown by callers */ }
  },
}));

let msgId = 0;
const newId = () => `m${++msgId}`;

// Chat transcript for this session (kept in memory, not saved to disk).
// Message kinds: user | assistant | buddy (local, never sent to AI) | capture (preview card).
export const useChat = create((set, get) => ({
  messages: [],
  context: [],           // captured texts / bookmarks attached to the next AI question
  draft: '',
  aiConsent: false,      // "allow for this session" was chosen
  pending: false,
  add(msg) {
    const m = { id: newId(), at: new Date().toISOString(), ...msg };
    set((s) => ({ messages: [...s.messages, m] }));
    return m.id;
  },
  patch(id, patch) { set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) })); },
  setDraft(draft) { set({ draft }); },
  attach(item) {
    set((s) => (s.context.some((c) => c.key === item.key) ? s : { context: [...s.context, item].slice(-10) }));
  },
  detach(key) { set((s) => ({ context: s.context.filter((c) => c.key !== key) })); },
  clearContext() { set({ context: [] }); },
  setAiConsent(v) { set({ aiConsent: v }); },
  setPending(v) { set({ pending: v }); },
  clear() { set({ messages: [], context: [], draft: '' }); },
  // Shows a capture result (from the shortcut, a delayed capture or a drop).
  receiveCapture(result) {
    if (!result) return;
    if (result.ok) get().add({ role: 'capture', capture: result, status: 'review' });
    else get().add({ role: 'buddy', text: result.message || 'Nothing was captured.', error: true });
  },
  async pullPending() {
    try { get().receiveCapture(await api.capture.pending()); } catch (err) { useToasts.getState().push(err.message, 'error'); }
  },
}));

// XP, streak, badges and rewards (derived in the main process). `burst`
// increments whenever something unlocks so the confetti overlay can fire.
export const useProgress = create((set) => ({
  state: null,
  burst: 0,
  async load() { try { set({ state: await api.progress.state() }); } catch { /* not critical */ } },
  async equip(patch) {
    try { set({ state: await api.progress.equip(patch) }); } catch (err) { useToasts.getState().push(err.message, 'error'); }
  },
  celebrate(events) {
    for (const e of events) {
      const reward = e.rewards?.length ? ` · Unlocked: ${e.rewards.join(', ')}` : '';
      useToasts.getState().push(e.kind === 'level' ? `⭐ Level ${e.level} — ${e.stage}!${reward}` : `${e.emoji} Badge unlocked: ${e.name}${reward}`, 'success');
    }
    set((s) => ({ burst: s.burst + 1 }));
  },
}));

// Wire main-process events to the stores once.
export function subscribeToMain() {
  const offs = [
    api.tasks.onChange(() => { useTasks.getState().load(); useProgress.getState().load(); }),
    api.progress.onUnlocked((events) => { useProgress.getState().celebrate(events); useProgress.getState().load(); }),
    api.settings.onChange((s) => useSettings.getState().receive(s)),
    api.sync.onStatus((s) => useSync.getState().receive(s)),
    api.bookmarks.onChange(() => useBookmarks.getState().refresh()),
    api.capture.onNew(() => useChat.getState().pullPending()),
  ];
  useBookmarks.getState().refresh();
  useProgress.getState().load();
  return () => offs.forEach((off) => off());
}
