// Shows alerts one at a time through the buddy and/or Windows notifications.
//
// Intensity:
//   subtle → bubble where the buddy stands, chime, no speech
//   normal → buddy runs to the screen centre, chime, speech (if enabled)
//   strong → normal + a Windows notification + one extra chime after 5 minutes
// Sound and speech are played once per alert (never looped). An alert stays up
// until the user acts or alertTimeoutMinutes passes (then it's marked EXPIRED).
const { Notification, shell } = require('electron');
const dialogue = require('../dialogue');

const REPEAT_CHIME_MS = 5 * 60_000;

function createPresenter({ getPet, settings, log, getEngine, openTasks, icon }) {
  const queue = [];
  let current = null;
  let timeoutTimer = null;
  let repeatTimer = null;
  let localId = 0;

  const isQueued = (deliveryId) =>
    (current && current.deliveryId === deliveryId) || queue.some((a) => a.deliveryId === deliveryId);

  function present(alert) {
    if (alert.deliveryId && isQueued(alert.deliveryId)) return;
    queue.push({ ...alert, alertId: alert.deliveryId ? `d${alert.deliveryId}` : `l${++localId}` });
    if (!current) showNext();
  }

  function view(a, s) {
    const opts = { personality: s.personality };
    if (a.kind === 'task') {
      const label = a.overdue ? 'Overdue' : a.minutesUntil > 0 ? `In ${a.minutesUntil} min` : 'Reminder';
      const buttons = [
        { action: 'done', label: '✓ Mark done', primary: true },
        { action: 'snooze', label: 'Snooze 5', minutes: 5 },
        { action: 'snooze', label: 'Snooze 10', minutes: 10 },
        { action: 'custom-snooze', label: '…' },
      ];
      if (a.link) buttons.push({ action: 'open-link', label: 'Open link' });
      buttons.push({ action: 'details', label: 'Details' }, { action: 'dismiss', label: 'Dismiss' });
      const line = dialogue.reminderLine(s.character, a, opts);
      return { label, title: a.title, line: s.personality ? line : '', speak: line, buttons, priority: a.priority };
    }
    if (a.kind === 'missed-summary') {
      const more = a.count > 3 ? ` +${a.count - 3} more` : '';
      return {
        label: 'While you were away',
        title: dialogue.line(s.character, 'missedSummary', { count: a.count }, opts),
        line: a.titles.slice(0, 3).join(' · ') + more,
        speak: dialogue.line(s.character, 'missedSummary', { count: a.count }, opts),
        buttons: [{ action: 'open-tasks', label: 'Review tasks', primary: true }, { action: 'ok', label: 'OK' }],
      };
    }
    return { // break
      label: 'Break time', title: a.tip, line: '', speak: a.tip,
      buttons: [{ action: 'ok', label: 'OK!', primary: true }, { action: 'snooze-breaks', label: 'Not now' }],
    };
  }

  function systemNotification(a, v) {
    if (!Notification.isSupported()) return null;
    try {
      const n = new Notification({ title: v.title || v.label, body: v.line || v.label, icon, silent: false });
      n.on('click', () => openTasks(a.taskId ? `/tasks/${a.taskId}` : '/tasks'));
      n.show();
      return n;
    } catch (err) {
      log.warn('system notification failed', { error: err.message });
      return null;
    }
  }

  function showNext() {
    current = queue.shift() || null;
    if (!current) return;
    const a = current;
    const s = settings.getAll();
    const v = view(a, s);
    const pet = getPet();
    const buddyAvailable = pet && pet.isVisible() && s.notificationMode !== 'system';

    try {
      if (!buddyAvailable || s.notificationMode === 'buddy+system' || s.intensity === 'strong') systemNotification(a, v);

      if (buddyAvailable) {
        const center = s.centerAnimation && s.intensity !== 'subtle' && s.animation !== 'off';
        pet.startReminder({ center });
        pet.send('alert', {
          ...v, alertId: a.alertId, deliveryId: a.deliveryId,
          chime: s.sound, speak: s.intensity === 'subtle' ? null : v.speak,
        });
        if (s.intensity === 'strong') repeatTimer = setTimeout(() => pet.send('pet:chime'), REPEAT_CHIME_MS);
      } else if (a.deliveryId) {
        // Without the buddy the notification is the presentation.
        getEngine().ack(a.deliveryId);
      }
    } catch (err) {
      log.error('presenting alert failed', { error: err.message, kind: a.kind });
      if (a.deliveryId) getEngine().fail(a.deliveryId, err.message);
    }

    timeoutTimer = setTimeout(() => act(a.alertId, a.kind === 'task' ? 'expire' : 'ok'), s.alertTimeoutMinutes * 60_000);
  }

  // Called when the buddy confirms the alert is on screen.
  function shown({ deliveryId }) {
    if (deliveryId) getEngine().ack(deliveryId);
  }

  function finish({ celebrate, say }) {
    clearTimeout(timeoutTimer);
    clearTimeout(repeatTimer);
    const pet = getPet();
    if (pet) {
      pet.send('alert:clear');
      pet.endReminder({ celebrate });
      if (say) setTimeout(() => pet.speak(say, 2500), 150);
    }
    current = null;
    if (queue.length) setTimeout(showNext, 1500);
  }

  function act(alertId, action, minutes) {
    const a = current;
    if (!a || a.alertId !== alertId) return;
    const s = settings.getAll();
    const opts = { personality: s.personality };

    try {
      switch (action) {
        case 'open-link':
          if (/^https?:\/\//i.test(a.link || '')) shell.openExternal(a.link);
          return;
        case 'details':
          openTasks(`/tasks/${a.taskId}`);
          return;
        case 'open-tasks':
          openTasks('/tasks');
          return finish({ celebrate: false });
        case 'snooze-breaks':
          settings.setInternal('breakSnoozedUntil', Date.now() + 60 * 60_000);
          return finish({ celebrate: false });
        case 'ok':
          return finish({ celebrate: false });
        case 'done':
        case 'dismiss':
        case 'expire':
        case 'snooze': {
          if (a.kind !== 'task') return finish({ celebrate: false });
          const mins = action === 'snooze' ? (minutes || s.defaultSnoozeMinutes) : undefined;
          getEngine().handleAction(a.occurrenceId, action, mins);
          const say = action === 'done' && s.personality ? dialogue.line(s.character, 'completed', {}, opts)
            : action === 'snooze' && s.personality ? dialogue.line(s.character, 'snoozed', { minutes: mins }, opts) : null;
          return finish({ celebrate: action === 'done', say });
        }
        default:
          log.warn('unknown alert action', { action });
      }
    } catch (err) {
      log.error('alert action failed', { action, error: err.message });
      finish({ celebrate: false });
    }
  }

  return { present, isQueued, shown, act, get current() { return current; } };
}

module.exports = { createPresenter };
