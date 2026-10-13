import { useEffect } from 'react';
import { useRoute, match, navigate } from './hooks/useRoute';
import { useTasks, useSettings, useSync, subscribeToMain } from './stores';
import { Toasts } from './components/ui';
import Sidebar from './components/Sidebar';
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
import Confetti from './features/progress/Confetti';

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

export default function App() {
  const path = useRoute();
  const settings = useSettings((s) => s.settings);
  useTheme(settings?.theme || 'system');

  useEffect(() => {
    useTasks.getState().load();
    useSettings.getState().load();
    useSync.getState().load();
    return subscribeToMain();
  }, []);

  // Ctrl+N anywhere opens a new task.
  useEffect(() => {
    const onKey = (e) => { if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); navigate('/tasks/new'); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  else if (path === '/calculator') page = <CalculatorPage />;
  else if (path === '/bookmarks') page = <BookmarksPage />;
  else if (match('/bookmarks/:id', path)) page = <BookmarksPage selectedId={match('/bookmarks/:id', path).id} />;
  else if (path === '/tasks/new') page = <TasksPage creating />;
  else if (view) page = <TasksPage view={view.view} />;
  else {
    const m = match('/tasks/:id', path);
    page = <TasksPage selectedId={m?.id} />;
  }

  return (
    <div className="flex h-full">
      <Sidebar path={path} />
      <main className="min-w-0 flex-1 overflow-y-auto">{page}</main>
      <Toasts />
      <Confetti />
    </div>
  );
}
