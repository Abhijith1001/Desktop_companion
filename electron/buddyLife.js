// The buddy's day-to-day life: mood and treats (services/mood.js), local
// weather (services/weather.js), seasonal decorations and greetings. The pet
// window draws all of it; this module decides what to show and say.
const { createMood, MOOD_EMOJI } = require('./services/mood');
const { createWeather } = require('./services/weather');

const NAG_EVERY_MS = 25 * 60_000;
const MOOD_LABEL = { happy: 'Happy', ok: 'Content', sulky: 'Sulking' };
const YUM = ['Yum! Thank you!', 'Nom nom nom 😋', 'Delicious! 🍪', 'Mmm, my favourite!'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// December → Santa hat; the last week of October → a pumpkin.
function seasonFor(d = new Date()) {
  if (d.getMonth() === 11) return 'christmas';
  if (d.getMonth() === 9 && d.getDate() >= 25) return 'halloween';
  return null;
}

function createBuddyLife({ db, tasks, settings, log, getPet, getManager, isBusy, openTasks, idleSeconds }) {
  const mood = createMood({ db, tasks, settings });
  const weather = createWeather({
    settings, log,
    onUpdate: (w) => { pushDecor(); getManager()?.send('weather:update', w); },
  });
  let timer = null;
  let lastNag = Date.now();

  const pet = () => getPet();
  const canTalk = () => { const p = pet(); return p && p.isVisible() && !p.isSleeping() && !isBusy(); };
  const say = (text, ms = 3500) => { if (canTalk()) pet().speak(text, ms); };

  function pushMood() {
    const s = mood.summary();
    pet()?.setMood({ level: s.level, hungry: s.hungry });
    getManager()?.send('buddy:stats', s);
    return s;
  }
  const pushDecor = () => pet()?.setDecor({ season: seasonFor(), weather: weather.current() });

  // Task changes: hand out treats for newly completed tasks.
  let queued = false;
  function onTasksChanged() {
    if (queued) return;
    queued = true;
    setImmediate(() => {
      queued = false;
      try {
        const earned = mood.checkCompletions();
        const s = pushMood();
        if (earned > 0) setTimeout(() => say(earned === 1 ? `You earned me a treat! 🍪 (${s.treats})` : `You earned ${earned} treats! 🍪`, 3000), 900);
      } catch (err) {
        log.warn('mood update failed', { error: err.message });
      }
    });
  }

  function feed() {
    const r = mood.feed();
    if (r.ok) pet()?.eat(pick(YUM));
    else say('No treats left — finish a task and I’ll earn one! 🍪', 3500);
    pushMood();
    return r;
  }

  function onPetted() { mood.pet(); pushMood(); }

  function weatherLine() {
    const w = weather.current();
    if (!w) return '';
    return ` It’s ${w.temp}°${w.unit} and ${w.description} in ${w.place} ${w.emoji}`;
  }

  // Once per day, the first time the buddy is awake with the user in the morning.
  function greetMorning() {
    const now = new Date();
    if (now.getHours() < 5 || now.getHours() >= 12 || !settings.get('onboarded')) return false;
    const today = now.toDateString();
    if (settings.getInternal('morningGreeted') === today || !canTalk() || idleSeconds() > 60) return false;
    settings.setInternal('morningGreeted', today);
    const s = mood.summary();
    const extra = s.overdue ? ` ${s.overdue} task${s.overdue === 1 ? ' is' : 's are'} waiting from before — let’s get ${s.overdue === 1 ? 'it' : 'them'} done!` : '';
    say(`Good morning! ☀️${weatherLine()}${extra}`, 7000);
    return true;
  }

  function onWake(kind) {
    if (greetMorning()) return;
    if (kind === 'back') setTimeout(() => say(pick(['Oh! You’re back! 👋', 'Welcome back!', '*stretch* …hi again!']), 2500), 600);
  }

  // Ask once (after onboarding) where the user lives, for the weather.
  function askLocation() {
    const w = settings.get('weather');
    if (!w.enabled || w.location || settings.getInternal('weatherAsked') || !settings.get('onboarded') || !canTalk()) return;
    settings.setInternal('weatherAsked', true);
    say('Where do you live? Tell me your city and I’ll show you the weather! 🌦️', 6000);
    setTimeout(() => openTasks('/settings'), 2500);
  }

  // Gentle reminders of how the buddy feels, at most every 25 minutes.
  function nag(s) {
    if (Date.now() - lastNag < NAG_EVERY_MS || !canTalk() || idleSeconds() > 120) return;
    if (s.level === 'sulky' && s.overdueTitle) say(`Hmph… “${s.overdueTitle}” is still overdue. 😤`, 4000);
    else if (s.hungry) say(s.treats ? 'My tummy’s rumbling… got a treat for me? 🍪' : 'I’m getting hungry… finish a task to earn me a treat? 🍪', 4000);
    else return;
    lastNag = Date.now();
  }

  function minute() {
    try {
      const s = pushMood();
      pushDecor();
      if (greetMorning()) return; // one thing to say per minute at most
      askLocation();
      nag(s);
    } catch (err) {
      log.warn('buddy life tick failed', { error: err.message });
    }
  }

  settings.onChange((_all, patch) => { if ('weather' in patch) weather.refresh(); });

  return {
    weather,
    feed,
    onPetted,
    onWake,
    onTasksChanged,
    stats: () => mood.summary(),
    // Short line under the hover hint: mood · treats · weather.
    hintStats() {
      const s = mood.summary();
      const w = weather.current();
      return `${MOOD_EMOJI[s.level]} ${MOOD_LABEL[s.level]}${s.hungry ? ' · hungry' : ''} · 🍪 ${s.treats}${w ? ` · ${w.emoji} ${w.temp}°${w.unit}` : ''}`;
    },
    start() {
      mood.checkCompletions(); // first run: start counting from now
      weather.start();
      pushMood();
      pushDecor();
      timer = setInterval(minute, 60_000);
      setTimeout(minute, 8000);
    },
    stop() { clearInterval(timer); weather.stop(); },
  };
}

module.exports = { createBuddyLife, seasonFor };
