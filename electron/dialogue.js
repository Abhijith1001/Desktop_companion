// Character dialogue. The same event produces different lines per character;
// with personality turned off every character uses the plain lines.
// Lines are short, kind and never shame the user for missed tasks.

const PLAIN = {
  welcome: () => 'Desktop Buddy is running.',
  reminder: ({ title }) => `Reminder: ${title}`,
  upcoming: ({ title, minutes }) => `${title} starts in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
  overdue: ({ title }) => `${title} is overdue.`,
  completed: () => 'Task completed.',
  snoozed: ({ minutes }) => `Snoozed for ${minutes} minutes.`,
  missedSummary: ({ count }) => `You missed ${count} reminders while away.`,
  break: ({ tip }) => tip,
  sleepy: () => 'Going to sleep.',
};

const CHARACTER_LINES = {
  dog: {
    welcome: () => 'Woof! I’m here. Let’s have a great day together!',
    reminder: ({ title }) => `Hey! It’s time to ${title}. You’ve got this!`,
    upcoming: ({ title, minutes }) => `Psst! ${title} starts in ${minutes} min. Want to get ready?`,
    overdue: ({ title }) => `Hey, we still have “${title}” to finish. Shall we tackle it together?`,
    completed: () => 'Yay, good job! *happy tail wags*',
    snoozed: ({ minutes }) => `Okay! I’ll nudge you again in ${minutes} minutes.`,
    missedSummary: ({ count }) => `Welcome back! ${count} reminders came up while you were away.`,
    sleepy: () => 'Yawn… time for a nap.',
  },
  tom: {
    welcome: () => 'Well, well, look who’s back. Let’s get things done… after a stretch.',
    reminder: ({ title }) => `Ahem! “${title}”. I’d do it myself, but… paws.`,
    upcoming: ({ title, minutes }) => `${title} in ${minutes} min. Plenty of time — but not too much!`,
    overdue: ({ title }) => `“${title}” is still waiting for you. Shall we stop postponing it?`,
    completed: () => 'Done? Impressive. I’ll allow it. 😼',
    snoozed: ({ minutes }) => `Fine, ${minutes} more minutes. I’m watching you.`,
    missedSummary: ({ count }) => `${count} reminders piled up while you were out. I kept them warm.`,
    sleepy: () => 'Catnap time.',
  },
  cat: {
    welcome: () => 'Meow! Ready when you are.',
    reminder: ({ title }) => `Meow! Time for “${title}”.`,
    upcoming: ({ title, minutes }) => `${title} in ${minutes} min. Just so you know. 🐾`,
    overdue: ({ title }) => `“${title}” is still waiting. Shall we stop postponing it?`,
    completed: () => 'Purrfect! Nicely done.',
    snoozed: ({ minutes }) => `Snoozing ${minutes} minutes. Purr.`,
    missedSummary: ({ count }) => `${count} reminders came up while you were away.`,
    sleepy: () => 'Curling up for a nap…',
  },
  hero: {
    welcome: () => 'Hero mode on! Let’s crush today’s missions!',
    reminder: ({ title }) => `Mission time: ${title}! Let’s go!`,
    upcoming: ({ title, minutes }) => `Heads up! ${title} in ${minutes} min. Gear up!`,
    overdue: ({ title }) => `One challenge left: “${title}”. Let’s finish this task!`,
    completed: () => 'Mission complete! Keep that streak going! ⚡',
    snoozed: ({ minutes }) => `Recharging for ${minutes} minutes. Then we strike!`,
    missedSummary: ({ count }) => `${count} missions are waiting for you, hero. One at a time!`,
    sleepy: () => 'Even heroes need rest.',
  },
  ranger: {
    welcome: () => 'Ranger reporting. Your schedule is loaded and on watch.',
    reminder: ({ title }) => `Scheduled now: ${title}.`,
    upcoming: ({ title, minutes }) => `${title} begins in ${minutes} minutes. Shall we prepare?`,
    overdue: ({ title }) => `“${title}” is overdue. Would you like to reschedule it or begin now?`,
    completed: () => 'Task complete. Well executed.',
    snoozed: ({ minutes }) => `Understood. Rescheduled reminder in ${minutes} minutes.`,
    missedSummary: ({ count }) => `${count} items came due while you were away. Let’s review them.`,
    sleepy: () => 'Standing down for the night.',
  },
};

function line(character, event, ctx = {}, { personality = true } = {}) {
  const set = personality ? CHARACTER_LINES[character] || CHARACTER_LINES.dog : {};
  const fn = set[event] || PLAIN[event];
  return fn ? fn(ctx) : '';
}

// Picks the right reminder event for an alert from the engine.
function reminderLine(character, alert, opts) {
  if (alert.overdue) return line(character, 'overdue', alert, opts);
  if (alert.minutesUntil > 0) return line(character, 'upcoming', { title: alert.title, minutes: alert.minutesUntil }, opts);
  return line(character, 'reminder', alert, opts);
}

const BREAK_TIPS = [
  'Time for a sip of water! 💧',
  'Stretch break! Roll those shoulders 🙆',
  'Look away from the screen for 20 seconds 👀',
  'Deep breath in… and out 🌬️',
  'Stand up and walk around a bit 🚶',
];

module.exports = { line, reminderLine, BREAK_TIPS, CHARACTER_IDS: Object.keys(CHARACTER_LINES) };
