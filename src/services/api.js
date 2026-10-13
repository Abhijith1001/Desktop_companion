// Thin wrapper over the preload bridge that turns IPC errors into readable
// messages ("Error invoking remote method 'x': Error: title: Required" → "title: Required").
const bridge = window.buddy;

const clean = (err) => {
  const msg = String(err && err.message ? err.message : err);
  return new Error(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
};

function wrap(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, fn]) => [
    k,
    k.startsWith('on') ? fn : async (...args) => { try { return await fn(...args); } catch (e) { throw clean(e); } },
  ]));
}

export const api = {
  tasks: wrap(bridge.tasks),
  settings: wrap(bridge.settings),
  reminders: wrap(bridge.reminders),
  progress: wrap(bridge.progress),
  buddy: wrap(bridge.buddy),
  weather: wrap(bridge.weather),
  sync: wrap(bridge.sync),
  bookmarks: wrap(bridge.bookmarks),
  capture: wrap(bridge.capture),
  ai: wrap(bridge.ai),
  notes: wrap(bridge.notes),
  onboarding: wrap(bridge.onboarding),
  app: wrap(bridge.app),
};
