import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../services/api';

// Minimal hash router: "#/tasks/123" → "/tasks/123".
const read = () => window.location.hash.replace(/^#/, '') || '/tasks';
const subscribe = (fn) => { window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn); };

export function navigate(path) {
  if (read() !== path) window.location.hash = path;
}

export function useRoute() {
  const path = useSyncExternalStore(subscribe, read);
  useEffect(() => api.app.onNavigate(navigate), []);
  return path;
}

// Matches "/tasks/:id" style patterns; returns params or null.
export function match(pattern, path) {
  const p = pattern.split('/');
  const a = path.split('/');
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}
