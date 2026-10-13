import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../electron/pet/characters.js';
import '../electron/pet/chimes.js';
import './index.css';
import App from './App.jsx';
import { api } from './services/api';

// Uncaught UI errors go to the main process, which reports them only if the
// user turned on crash reports.
const report = (message, stack) => api.community.reportError({ message: String(message || '').slice(0, 1000), stack: String(stack || '').slice(0, 8000) }).catch(() => {});
window.addEventListener('error', (e) => report(e.message, e.error?.stack));
window.addEventListener('unhandledrejection', (e) => report(e.reason?.message || e.reason, e.reason?.stack));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
