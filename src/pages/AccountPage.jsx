import { useState } from 'react';
import { useSync, useToasts } from '../stores';
import { api } from '../services/api';
import { Section, Field } from '../components/ui';
import { formatWhen } from '../utils/dates';

function SignInForm({ defaultUrl }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState(defaultUrl || 'http://localhost:4000');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const receive = useSync((s) => s.receive);
  const toast = useToasts((s) => s.push);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      receive(await api.sync.signIn({ email, password, serverUrl: serverUrl.trim() }, mode === 'register'));
      toast(mode === 'register' ? 'Account created — your tasks are syncing' : 'Signed in — syncing your tasks');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 py-3">
      <div className="flex gap-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800" role="tablist">
        {[['login', 'Sign in'], ['register', 'Create account']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
            className={`flex-1 rounded-md py-1.5 text-sm font-semibold ${mode === id ? 'bg-white shadow-sm dark:bg-stone-700' : 'text-stone-500'}`}>{label}</button>
        ))}
      </div>
      <Field label="Email" htmlFor="em"><input id="em" type="email" className="input" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Password" htmlFor="pw" hint={mode === 'register' ? 'At least 8 characters' : null}>
        <input id="pw" type="password" className="input" required minLength={8} autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Sync server" htmlFor="srv" hint="Your Desktop Buddy API (https:// required except for localhost)">
        <input id="srv" type="url" className="input" required value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
      </Field>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <button type="submit" className="btn-primary justify-self-start" disabled={busy}>{busy ? 'Connecting…' : mode === 'register' ? 'Create account & sync' : 'Sign in & sync'}</button>
    </form>
  );
}

export default function AccountPage() {
  const status = useSync((s) => s.status);
  const receive = useSync((s) => s.receive);
  const toast = useToasts((s) => s.push);
  if (!status) return null;

  const syncNow = async () => {
    const s = await api.sync.now();
    receive(s);
    toast(s.lastError ? `Sync failed: ${s.lastError}` : 'Synced', s.lastError ? 'error' : 'info');
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Account & sync</h1>
        <p className="text-sm text-stone-500">Optional. Reminders always work offline — sync only keeps your tasks in step across computers.</p>
      </header>

      {!status.signedIn ? (
        <Section title="Connect to the cloud">
          {status.lastError && <p className="py-2 text-sm text-amber-700 dark:text-amber-400">{status.lastError}</p>}
          <SignInForm defaultUrl={status.serverUrl} />
        </Section>
      ) : (
        <>
          <Section title="Sync status">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 py-3 text-sm">
              <dt className="text-stone-500">Signed in as</dt><dd className="font-medium">{status.email}</dd>
              <dt className="text-stone-500">Server</dt><dd className="break-all">{status.serverUrl}</dd>
              <dt className="text-stone-500">Status</dt>
              <dd>{status.syncing ? '⟳ Syncing…' : status.lastError ? <span className="text-red-600 dark:text-red-400">⚠ {status.lastError}</span> : status.online === false ? 'Offline — will retry' : '✓ Up to date'}</dd>
              <dt className="text-stone-500">Last synced</dt><dd>{status.lastSyncAt ? formatWhen(status.lastSyncAt) : 'Never'}</dd>
              <dt className="text-stone-500">Waiting to upload</dt><dd>{status.pending} change{status.pending === 1 ? '' : 's'}</dd>
            </dl>
            <div className="flex gap-2 py-3">
              <button type="button" className="btn-primary" onClick={syncNow} disabled={status.syncing}>Sync now</button>
              <button type="button" className="btn-outline" onClick={async () => { receive(await api.sync.signOut()); toast('Signed out. Tasks stay on this computer.'); }}>Sign out</button>
            </div>
          </Section>
          <Section title="Your data">
            <div className="flex flex-wrap gap-2 py-3">
              <button type="button" className="btn-outline" onClick={async () => { const p = await api.sync.exportData(); if (p) toast(`Exported to ${p}`); }}>Export all data</button>
              <button type="button" className="btn-danger" onClick={async () => { const s = await api.sync.deleteAccount(); receive(s); if (!s.signedIn) toast('Cloud account deleted'); }}>Delete cloud account</button>
            </div>
            <p className="py-2 text-xs text-stone-500">Deleting your cloud account removes synced data from the server. Tasks on this computer are kept.</p>
          </Section>
        </>
      )}
    </div>
  );
}
