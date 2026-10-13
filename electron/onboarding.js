// First-run welcome: sample tasks so the app never opens empty, the buddy's
// entrance, and the cues the welcome page uses to make the buddy talk and
// walk around during the tutorial.
const v = require('./services/validation');

const WEEKDAYS = [1, 2, 3, 4, 5];
const SAMPLES = [
  { title: 'Drink water 💧', at: [11, 0], recurrence: { type: 'daily' } },
  { title: 'Stretch break 🧘', at: [15, 0], recurrence: { type: 'weekdays', weekdays: WEEKDAYS } },
  { title: 'Plan tomorrow 📝', at: [17, 30], recurrence: { type: 'weekdays', weekdays: WEEKDAYS } },
];

// Next local time hh:mm from now, as ISO.
function nextAt([hh, mm], now = new Date()) {
  const d = new Date(now);
  d.setHours(hh, mm, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function createOnboarding({ settings, tasks, getPet, getManager, onTasksChanged, log }) {
  let active = false;   // first-run entrance pending or in progress
  let entered = false;

  const pet = () => getPet();
  const speak = (text, ms = 4500) => { if (text) pet().speak(text, ms); };

  // Decides whether this launch shows the welcome flow. Upgrading users who
  // already have tasks are treated as onboarded.
  function prepare({ autostart }) {
    if (settings.get('onboarded')) return false;
    if (!settings.getInternal('onboardingStarted') && tasks.list().length) {
      settings.update({ onboarded: true });
      return false;
    }
    if (!settings.getInternal('onboardingStarted')) {
      settings.setInternal('onboardingStarted', true);
      seedSamples();
    }
    active = !autostart;
    return active;
  }

  function seedSamples() {
    const timeZone = settings.get('timeZone');
    for (const s of SAMPLES) {
      try {
        tasks.create(v.parse(v.taskInput, {
          title: s.title, category: 'Sample', priority: 'LOW', timeZone,
          dueAt: nextAt(s.at), recurrence: s.recurrence,
          description: 'A sample task to show how reminders work. Edit or delete it any time.',
        }));
      } catch (err) {
        log.warn('sample task failed', { title: s.title, error: err.message });
      }
    }
    onTasksChanged();
  }

  // Called once the pet window has loaded: walk in, wave, say hello, then
  // open the welcome page next to the buddy.
  function onPetReady() {
    if (!active || entered) return false;
    entered = true;
    let opened = false;
    const openWelcome = () => { if (!opened) { opened = true; getManager().open('/welcome'); } };
    setTimeout(() => {
      pet().walkIn({
        onArrive: () => {
          speak("Hi there! 👋 I'm your new desktop buddy. Let's get set up — it takes about a minute!", 5500);
          setTimeout(openWelcome, 1600);
        },
      });
    }, 500);
    setTimeout(openWelcome, 9000); // never leave the user waiting if the walk is interrupted
    return true;
  }

  // Cues from the welcome page.
  function cue({ cue: name, text, ms }) {
    const p = pet();
    if (!p) return false;
    if (!p.isVisible() && name !== 'show') p.show();
    switch (name) {
      case 'show': p.show(); speak(text, ms); break;
      case 'say': speak(text, ms); break;
      case 'wave': p.wave(); speak(text, ms); break;
      case 'tray': p.goTo('tray', { onArrive: () => speak(text, ms) }); break;
      case 'home': p.goTo('home', { onArrive: () => speak(text, ms) }); break;
      default: return false;
    }
    return true;
  }

  // Tutorial progress the welcome page listens for (drag, hide/show, right-click).
  const event = (name) => getManager()?.send('onboarding:event', name);

  function finish({ startWithWindows }) {
    active = false;
    settings.update({ onboarded: true, startWithWindows: !!startWithWindows });
    const p = pet();
    if (p) {
      if (!p.isVisible()) p.show();
      p.goTo('home');
      p.wave();
      const name = settings.get('buddyName');
      speak(`All set! ${name ? `${name} is` : "I'm"} here whenever you need me. 🐾`, 4500);
    }
    return settings.getAll();
  }

  return { prepare, onPetReady, cue, event, finish, holdEntrance: () => active && !entered };
}

module.exports = { createOnboarding, SAMPLES, nextAt };
