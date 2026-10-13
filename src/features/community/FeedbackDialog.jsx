import { useState } from 'react';
import { Modal, Field } from '../../components/ui';
import { useToasts } from '../../stores';
import { api } from '../../services/api';

const KINDS = [
  { id: 'idea', label: '💡 Idea' },
  { id: 'bug', label: '🐞 Problem' },
  { id: 'love', label: '❤️ Love it' },
  { id: 'other', label: '💬 Other' },
];

export default function FeedbackDialog({ onClose }) {
  const toast = useToasts((x) => x.push);
  const [kind, setKind] = useState('idea');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.community.sendFeedback({ kind, message, email: email.trim() });
      toast('Thanks! Your feedback was sent 🐾');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Send feedback" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={send}>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Type of feedback">
          {KINDS.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => setKind(k.id)}
              className={`rounded-xl border-2 px-2 py-2 text-sm font-medium transition-colors ${kind === k.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-stone-200 hover:border-stone-300 dark:border-stone-700'}`}>
              {k.label}
            </button>
          ))}
        </div>
        <Field label="Message" htmlFor="fb-msg">
          <textarea id="fb-msg" className="input min-h-32" required minLength={3} maxLength={4000} value={message}
            placeholder={kind === 'bug' ? 'What happened, and what did you expect?' : 'Tell us what you think…'}
            onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <Field label="Email (optional)" htmlFor="fb-email" hint="Only if you'd like a reply. Your app version and Windows version are included; tasks and notes never are.">
          <input id="fb-email" type="email" className="input" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || message.trim().length < 3}>{busy ? 'Sending…' : 'Send'}</button>
        </div>
      </form>
    </Modal>
  );
}
