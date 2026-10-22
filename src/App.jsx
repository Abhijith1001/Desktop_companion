import { useEffect, useState } from 'react';
import { useRoute, match, navigate } from './hooks/useRoute';
import { useTasks, useSettings, useSync, subscribeToMain, useHabits } from './stores';
import { Toasts } from './components/ui';
import Sidebar from './components/Sidebar';
import Icon from './components/Icon';
import TasksPage from './pages/TasksPage';
import CalendarPage from './pages/CalendarPage';
import CharactersPage from './pages/CharactersPage';
import SettingsPage from './pages/SettingsPage';
import AccountPage from './pages/AccountPage';
import ChatPage from './pages/ChatPage';
import BookmarksPage from './pages/BookmarksPage';
import NotepadPage from './pages/NotepadPage';
import CalculatorPage from './pages/CalculatorPage';
import WelcomePage from './pages/WelcomePage';
import ProgressPage from './pages/ProgressPage';
import PomodoroPage from './pages/PomodoroPage';
import HabitsPage from './pages/HabitsPage';
import PhonePage from './pages/PhonePage';
import ProjectsPage from './pages/ProjectsPage';
import Confetti from './features/progress/Confetti';
import AnnouncementBanner from './features/community/AnnouncementBanner';
import QuickCapture from './features/capture/QuickCapture';
import { applyAccent, resolveAccent } from './utils/accent';

function useTheme(theme) {
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme !== 'light' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function useAccent(accent, character) {
  useEffect(() => { applyAccent(resolveAccent(accent, character)); }, [accent, character]);
}

export default function App() {
  const path = useRoute();
  const settings = useSettings((s) => s.settings);
  useTheme(settings?.theme || 'system');
  useAccent(settings?.accent, settings?.character);
  const [quickCapture, setQuickCapture] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // The narrow-window drawer closes on navigation and on Escape.
  useEffect(() => { setNavOpen(false); }, [path]);
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  useEffect(() => {
    useTasks.getState().load();
    useSettings.getState().load();
    useSync.getState().load();
    useHabits.getState().load();
    return subscribeToMain();
  }, []);

  // Ctrl+N: new task. Ctrl+Shift+Space: quick capture.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); navigate('/tasks/new'); }
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') { e.preventDefault(); setQuickCapture(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Quick-capture route from global shortcut in the main process
  useEffect(() => {
    if (path === '/quick-capture') { setQuickCapture(true); navigate('/tasks'); }
  }, [path]);

  if (!settings) return null;

  if (path === '/welcome') return <><WelcomePage /><Toasts /></>;

  let page;
  const view = match('/tasks/view/:view', path);
  if (path === '/calendar') page = <CalendarPage />;
  else if (path === '/characters') page = <CharactersPage />;
  else if (path === '/progress') page = <ProgressPage />;
  else if (path === '/settings') page = <SettingsPage />;
  else if (path === '/account') page = <AccountPage />;
  else if (path === '/chat') page = <ChatPage />;
  else if (path === '/notepad') page = <NotepadPage />;
  else if (match('/notepad/:id', path)) page = <NotepadPage selectedId={match('/notepad/:id', path).id} />;
  else if (path === '/projects') page = <ProjectsPage />;
  else if (match('/projects/:id', path)) page = <ProjectsPage selectedId={match('/projects/:id', path).id} />;
  else if (path === '/calculator') page = <CalculatorPage />;
  else if (path === '/bookmarks') page = <BookmarksPage />;
  else if (match('/bookmarks/:id', path)) page = <BookmarksPage selectedId={match('/bookmarks/:id', path).id} />;
  else if (path === '/pomodoro') page = <PomodoroPage />;
  else if (path === '/habits') page = <HabitsPage />;
  else if (path === '/phone') page = <PhonePage />;
  else if (path === '/tasks/new') page = <TasksPage creating />;
  else if (view) page = <TasksPage view={view.view} />;
  else {
    const m = match('/tasks/:id', path);
    page = <TasksPage selectedId={m?.id} />;
  }

  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg dark:focus:bg-stone-800"
        onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <Sidebar path={path} open={navOpen} onClose={() => setNavOpen(false)} />
      <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col overflow-y-auto outline-none">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-stone-200 bg-stone-50/95 px-3 py-2 backdrop-blur md:hidden dark:border-stone-800 dark:bg-stone-950/95">
          <button type="button" className="btn-ghost px-2" onClick={() => setNavOpen(true)} aria-label="Open menu" aria-controls="main-nav" aria-expanded={navOpen}>
            <Icon name="menu" size={20} />
          </button>
          <span className="flex-1 text-sm font-semibold">Desktop Buddy</span>
          <button type="button" className="btn-primary px-2.5" onClick={() => navigate('/tasks/new')} aria-label="New task"><Icon name="plus" size={16} strokeWidth={2.25} /></button>
        </div>
        <AnnouncementBanner />
        <div key={path.split('/').slice(0, 2).join('/')} className="page-in min-h-0 flex-1">{page}</div>
      </main>
      <Toasts />
      <Confetti />
      {quickCapture && (
        <QuickCapture onClose={() => setQuickCapture(false)} />
      )}
    </div>
  );
}