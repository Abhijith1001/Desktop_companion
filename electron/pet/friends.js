// A second buddy ("friend") and the little scenes the two play together:
// greeting and chatting, meeting halfway, playing tag and following each
// other around. Sprite (video) characters are never used as the friend, and
// scenes don't run while the main buddy is a sprite character: their poses
// don't cover waving and the like.
const { createPetWindow, SPRITE_IDS } = require('../windows/pet');

const TICK_MS = 1500;
const SCENE_TIMEOUT_MS = 30_000;
const FIRST_SCENE_MS = 6000;
const nextGap = () => 20_000 + Math.random() * 25_000;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const HELLOS = ['Hi {name}!', 'Hey there, {name}!', 'Oh, it’s you, {name}! 👋', 'Psst, {name}!'];
const REPLIES = ['Hello! 👋', 'Hiya!', 'Good to see you!', 'Oh hey!'];
const CHATS = [
  ['Nice weather on this desktop, huh?', 'So many windows today!'],
  ['Did you see all those tasks?', 'We’ll cheer them on!'],
  ['I found a cozy spot on a window.', 'Save me a seat!'],
  ['What are you thinking about?', 'Snacks. Always snacks.'],
  ['Our human is working hard.', 'Let’s be quiet… ish.'],
  ['Do you ever wonder what’s behind the taskbar?', 'Shh, don’t go there.'],
];
const TAUNTS = ['Can’t catch me!', 'Race you!', 'Tag, you’re it!'];
const CAUGHT = ['Gotcha! 😄', 'Tag! Haha!', 'Caught you!'];
const PANTING = ['*pant pant* No fair!', 'You’re fast!', 'Okay, okay, you win!'];
const FOLLOW = ['Follow me!', 'This way!', 'Come on, let’s explore!'];
const FOLLOWING = ['Right behind you!', 'Wait up!', 'Coming!'];

function createFriends({ settings, log, getPet, characters, onMenu, onClick }) {
  let friend = null;
  let scene = null;          // { timers, endsAt } while a scene is playing
  let nextAt = Date.now() + FIRST_SCENE_MS;
  const nameOf = (id) => characters().find((c) => c.id === id)?.name || 'friend';
  const friendId = () => {
    const id = settings.get('friendCharacter');
    return id && !SPRITE_IDS.has(id) && characters().some((c) => c.id === id) ? id : 'cat';
  };

  // The friend's view of the settings: its own character and position, no
  // accessory, and hidden whenever the main buddy is.
  const view = (all) => ({ ...all, character: friendId(), accessory: null, position: all.friendPosition, buddyHidden: !!all.buddyHidden });
  const friendSettings = {
    get: (k) => view(settings.getAll())[k],
    getAll: () => view(settings.getAll()),
    update(patch) {
      const out = {};
      if ('position' in patch) out.friendPosition = patch.position;
      return Object.keys(out).length ? settings.update(out) : view(settings.getAll());
    },
    onChange: () => () => {},
  };

  function open() {
    if (friend) return;
    friend = createPetWindow({
      friend: true, settings: friendSettings, log,
      hint: () => null, onDropText: () => null, onReady: () => {},
      onClick, onMenu,
    });
    nextAt = Date.now() + FIRST_SCENE_MS;
  }

  function close() {
    endScene();
    if (!friend) return;
    friend.destroy();
    friend = null;
  }

  // ---------- scenes
  function endScene() {
    if (!scene) return;
    for (const t of scene.timers) clearTimeout(t);
    scene = null;
    nextAt = Date.now() + nextGap();
    for (const p of [getPet(), friend]) if (p && p.isScripted()) p.script(false);
  }

  // Run a step later, unless the scene was cut short in the meantime.
  function later(ms, fn) {
    const own = scene;
    const t = setTimeout(() => { if (scene === own) fn(); }, ms);
    scene.timers.push(t);
  }

  // Call `then` once every move has arrived.
  function whenAll(n, then) {
    let left = n;
    return () => { if (--left === 0) then(); };
  }

  const standApart = (a, b) => Math.max(a.center().w, b.center().w) * 0.5;

  function faceEachOther(a, b) {
    const ax = a.center().x;
    const bx = b.center().x;
    a.face(bx - ax);
    b.face(ax - bx);
  }

  // Hello, reply, then one little exchange.
  function chat(a, b, aId, bId) {
    faceEachOther(a, b);
    const [line1, line2] = pick(CHATS);
    a.act('WAVING');
    a.say(pick(HELLOS).replace('{name}', nameOf(bId)));
    later(2200, () => { b.act('WAVING'); b.say(pick(REPLIES)); });
    later(4600, () => { a.act('SPEAKING'); a.say(line1, 2600); });
    later(7400, () => { b.act('SPEAKING'); b.say(line2, 2600); });
    later(10_200, () => { a.act('CELEBRATING'); b.act('CELEBRATING'); });
    later(12_400, endScene);
  }

  function meet(a, b, aId, bId) {
    const ax = a.center().x;
    const bx = b.center().x;
    const mid = (ax + bx) / 2;
    const half = standApart(a, b) / 2;
    const side = bx > ax ? 1 : -1;
    const arrived = whenAll(2, () => chat(a, b, aId, bId));
    a.moveTo(mid - side * half, { onArrive: arrived });
    b.moveTo(mid + side * half, { onArrive: arrived });
  }

  // a chases b to the far side, tags it, and b sulks a little.
  function tag(a, b) {
    const ax = a.center().x;
    const bx = b.center().x;
    const away = bx >= ax ? 1 : -1;
    const runTo = bx + away * (350 + Math.random() * 250);
    b.say(pick(TAUNTS), 1600);
    b.face(away);
    later(500, () => {
      b.moveTo(runTo, { run: true });
      later(350, () => a.moveTo(runTo - away * standApart(a, b), {
        run: true,
        onArrive: () => {
          faceEachOther(a, b);
          a.act('CELEBRATING');
          a.say(pick(CAUGHT), 2000);
          later(1800, () => { b.act('ANGRY'); b.say(pick(PANTING), 2000); });
          later(4200, endScene);
        },
      }));
    });
  }

  // a leads a short walk, b follows a step behind, then they chat.
  function follow(a, b, aId, bId, legs = 2 + Math.floor(Math.random() * 2)) {
    const ax = a.center().x;
    const dirn = Math.random() < 0.5 ? -1 : 1;
    const to = ax + dirn * (200 + Math.random() * 300);
    if (legs > 1 || !scene.followed) { a.say(pick(FOLLOW), 1500); scene.followed = true; }
    const arrived = whenAll(2, () => {
      if (legs > 1) later(600, () => follow(a, b, aId, bId, legs - 1));
      else chat(a, b, aId, bId);
    });
    a.moveTo(to, { onArrive: arrived });
    later(700, () => {
      if (Math.random() < 0.4) b.say(pick(FOLLOWING), 1400);
      b.moveTo(to - Math.sign(to - b.center().x || 1) * standApart(a, b), { onArrive: arrived });
    });
  }

  function startScene() {
    const pet = getPet();
    const mainId = settings.get('character');
    const fId = friendId();
    const both = [[pet, mainId], [friend, fId]];
    if (Math.random() < 0.5) both.reverse();
    const [[a, aId], [b, bId]] = both;
    scene = { timers: [], endsAt: Date.now() + SCENE_TIMEOUT_MS };
    pet.script(true);
    friend.script(true);
    const dist = Math.abs(a.center().x - b.center().x);
    const near = dist < standApart(a, b) * 1.6;
    const r = Math.random();
    if (near) {
      if (r < 0.5) chat(a, b, aId, bId); else if (r < 0.8) tag(a, b); else follow(a, b, aId, bId);
    } else if (r < 0.45) meet(a, b, aId, bId);
    else if (r < 0.75) tag(a, b);
    else follow(a, b, aId, bId);
  }

  function tick() {
    const pet = getPet();
    if (!friend || !pet) return;
    if (scene) {
      // The user grabbed one of them, a reminder came up, or it ran too long.
      if (Date.now() > scene.endsAt || !pet.isScripted() || !friend.isScripted()) endScene();
      return;
    }
    if (Date.now() < nextAt || SPRITE_IDS.has(settings.get('character'))) return;
    if (!pet.isFree() || !friend.isFree() || pet.center().displayId !== friend.center().displayId) return;
    try { startScene(); } catch (err) { log.error('friend scene failed', { error: err.message }); endScene(); }
  }

  const timer = setInterval(tick, TICK_MS);

  const unsubscribe = settings.onChange((all, patch) => {
    if ('friendEnabled' in patch) { if (all.friendEnabled) open(); else close(); }
    if (!friend) return;
    if ('friendCharacter' in patch) { endScene(); friend.applySettings({ character: true }); }
    if ('buddyHidden' in patch) { endScene(); if (all.buddyHidden) friend.hide(); else friend.show(); }
    const { character, accessory, position, ...rest } = patch;
    if (Object.keys(rest).length) friend.applySettings(rest);
  });

  if (settings.get('friendEnabled')) open();

  return {
    stop() { clearInterval(timer); unsubscribe(); close(); },
    get friend() { return friend; },
  };
}

module.exports = { createFriends };
