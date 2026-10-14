// The transparent buddy window: position, movement, dragging and animation
// state. Movement runs only while something is actually moving, and stops
// entirely while the buddy is hidden.
const path = require('path');
const { app, BrowserWindow, ipcMain, screen, powerMonitor } = require('electron');
const { AnimationController, STATES } = require('../pet/controller');
const { createWindowProbe } = require('../pet/windowProbe');

const BASE_W = 340;
const BASE_H = 400;
const TICK_MS = 33;
const SPEED = { WALKING: 2, RUNNING: 7, glide: 6 };
const LOOK_RANGE = 113;      // ≈3 cm at 96 DPI, in DIPs: the buddy watches the cursor inside this
const TURN_COOLDOWN_MS = 800; // least time between turning round to face the cursor
const CHASE_RANGE = 450;     // cursor this close (horizontally) may get chased
const AFK_SECONDS = 5 * 60;  // nap after this long without keyboard/mouse input
const NIGHT_IDLE_SECONDS = 60;
const FOOT = 10;             // CSS px between the window bottom and the buddy's feet line
const CALM = ['IDLE', 'SITTING', 'LOOKING_AROUND'];

function createPetWindow({ settings, log, onClick, onMenu, onReady, hint, onDropText, onDragged = () => {}, holdEntrance = () => false, onPetted = () => {}, onWake = () => {} }) {
  let win = null;
  let size = settings.get('characterSize');
  let reducedMotion = false;
  let loop = null;
  let brain = null;
  let drag = null;
  let target = null;        // { x, y, onArrive } for runs to the centre and back
  let home = null;          // where to return after a reminder
  let tourHome = null;      // where to return after the onboarding tour
  let lastPos = '';
  let lastSentCss = '';
  let hitbox = null;        // the buddy's box inside the window, in CSS px
  let overBuddy = false;
  let hover = null;
  const pos = { x: 0, y: 0 };
  let dir = -1;
  let clickTimer = null;
  let lastClickTime = 0;
  let clickCount = 0;
  let perch = null;         // { hwnd, top, left, right, since, until } while sitting on a window
  let hopDown = false;      // leaving a perch on purpose: land softly
  let afk = false;          // asleep because the user is away
  let look = null;          // last cursor offset sent to the renderer
  let lastTurnAt = 0;
  let lastCursor = { x: 0, y: 0, movedAt: 0 };
  let lastChase = 0;
  let lastYawn = 0;
  let lastMood = null;      // resent when the renderer reloads
  let lastDecor = null;
  const probe = createWindowProbe({ log });
  const EMOTIONAL_STATES = [STATES.ANGRY, STATES.FALLING, STATES.IMPACT, STATES.DIZZY, STATES.RECOVERING];
  const physics = {
    vx: 0,              // Current horizontal velocity (px/tick)
    vy: 0,              // Current vertical velocity (gravity / toss)
    targetVx: 0,        // Target horizontal velocity
    accel: 0.16,        // Human walking acceleration rate
    decel: 0.24,        // Human deceleration / ground friction rate
    gaitPhase: 0,       // Walking gait cycle phase angle (0..2PI)
    dragSamples: [],    // Cursor trajectory samples for toss inertia: [{ x, y, t }]
    dragTilt: 0,        // Rotational drag inertia
  };

  const dims = () => ({ w: Math.round(BASE_W * size), h: Math.round(BASE_H * size) });
  const alive = () => win && !win.isDestroyed();
  const send = (ch, payload) => { if (alive()) win.webContents.send(ch, payload); };

  const controller = new AnimationController({
    onChange: (_state, css) => {
      lastSentCss = css;
      send('pet:state', { css, dir });
      ensureLoop();
    },
  });

  const animationMode = () => {
    const a = settings.get('animation');
    if (a === 'off') return 'off';
    return a === 'reduced' || reducedMotion ? 'reduced' : 'full';
  };

  function display() {
    const { w, h } = dims();
    return screen.getDisplayNearestPoint({ x: Math.round(pos.x + w / 2), y: Math.round(pos.y + h / 2) });
  }
  const groundY = (d = display()) => (perch
    ? perch.top - dims().h + FOOT * size
    : d.workArea.y + d.workArea.height - dims().h);

  // Horizontal range for the window position: the screen, or the top edge of
  // the window the buddy is sitting on.
  function bounds(d = display()) {
    const { w } = dims();
    if (perch && Number.isFinite(perch.left) && Number.isFinite(perch.right)) {
      const margin = 45 * size;
      const minX = perch.left + margin - w / 2;
      const maxX = Math.max(minX, perch.right - margin - w / 2);
      return { minX, maxX };
    }
    const area = d?.workArea || screen.getPrimaryDisplay()?.workArea || { x: 0, y: 0, width: 1920, height: 1080 };
    return { minX: area.x - 60, maxX: area.x + area.width - w + 60 };
  }

  function clampToDisplay() {
    const d = display();
    let { minX, maxX } = bounds(d);
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
      const area = screen.getPrimaryDisplay()?.workArea || { x: 0, y: 0, width: 1920, height: 1080 };
      minX = area.x - 60;
      maxX = area.x + area.width - dims().w + 60;
    }
    if (!Number.isFinite(pos.x)) pos.x = maxX - 60;
    pos.x = Math.min(Math.max(pos.x, minX), maxX);
    if (!drag && !target) {
      pos.y = groundY(d);
      physics.vy = 0;
    }
    if (!Number.isFinite(pos.y)) pos.y = groundY(d);
    if (!Number.isFinite(pos.y)) pos.y = (screen.getPrimaryDisplay()?.workArea?.height || 1080) - dims().h;
    apply();
  }

  function apply() {
    if (!alive()) return;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      const area = screen.getPrimaryDisplay()?.workArea || { x: 0, y: 0, width: 1920, height: 1080 };
      pos.x = area.x + area.width - dims().w - 40;
      pos.y = area.y + area.height - dims().h;
    }
    const rx = Math.round(pos.x);
    const ry = Math.round(pos.y);
    if (!Number.isInteger(rx) || !Number.isInteger(ry)) return;
    const key = `${rx},${ry}`;
    if (key === lastPos) return;
    lastPos = key;
    try {
      win.setPosition(rx, ry);
    } catch { /* window could be closing or unready */ }
  }

  function needsLoop() {
    if (!alive() || !win.isVisible()) return false;
    if (drag || target) return true;
    if (controller.until) return true;
    if (controller.isMoving && animationMode() === 'full') return true;
    if (EMOTIONAL_STATES.includes(controller.state)) return true;
    if (Math.abs(physics.vx) > 0.05 || Math.abs(physics.vy) > 0.05) return true;
    return Math.abs(pos.y - groundY()) > 1;
  }

  function ensureLoop() {
    if (loop || !needsLoop()) return;
    loop = setInterval(step, TICK_MS);
  }

  function setDir(d) {
    if (d === dir) return;
    dir = d;
    send('pet:state', { css: lastSentCss || controller.css, dir });
  }

  function step() {
    if (controller.until) controller.tick();
    if (!needsLoop()) { clearInterval(loop); loop = null; return; }
    const d = display();
    const { minX, maxX } = bounds(d);

    if (drag) {
      const c = screen.getCursorScreenPoint();
      const now = Date.now();
      const lastX = drag.lastX ?? c.x;
      const dx = c.x - lastX;
      drag.lastX = c.x;
      drag.lastY = c.y;
      const speed = Math.hypot(dx, c.y - (drag.lastY ?? c.y));

      pos.x = c.x - drag.offX;
      pos.y = c.y - drag.offY;
      if (Math.abs(c.x - drag.startX) + Math.abs(c.y - drag.startY) > 6) { drag.moved = true; perch = null; }
      physics.dragSamples.push({ x: c.x, y: c.y, t: now });
      if (physics.dragSamples.length > 5) physics.dragSamples.shift();
      physics.vx = 0;
      physics.vy = 0;
      physics.gaitPhase = 0;

      // React to motion while dragging: dynamic tilt and secondary motion
      const targetTilt = Math.max(-25, Math.min(25, -dx * 2.2));
      physics.dragTilt = (physics.dragTilt || 0) * 0.65 + targetTilt * 0.35;
      send('pet:drag-motion', { tilt: physics.dragTilt, speed, fast: speed > 7 });
    } else if (target) {
      if (animationMode() !== 'full') { pos.x = target.x; pos.y = target.y; }
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const dist = Math.hypot(dx, dy);
      const cruiseSpeed = controller.state === STATES.RUNNING ? SPEED.RUNNING : SPEED.glide;
      // Human-like arrival steering: decelerate smoothly as target approaches
      const speed = dist < 45 ? Math.max(1.5, cruiseSpeed * (dist / 45)) : cruiseSpeed;
      if (Math.abs(dx) > 3) setDir(dx > 0 ? 1 : -1);
      if (dist <= Math.max(speed, 2.5)) {
        pos.x = target.x;
        pos.y = target.y;
        physics.vx = 0;
        physics.vy = 0;
        const done = target.onArrive;
        target = null;
        if (done) done();
      } else {
        pos.x += (dx / dist) * speed;
        pos.y += (dy / dist) * speed;
      }
    } else {
      const gy = groundY(d);
      const isAirborne = pos.y < gy - 1;

      // 1. Vertical Physics (Gravity & Ground Impact)
      if (isAirborne) {
        physics.vy += 0.85; // Gravity acceleration (g)
        if (physics.vy > 18) physics.vy = 18; // Terminal velocity
        pos.y += physics.vy;

        // Ground collision
        if (pos.y >= gy) {
          pos.y = gy;
          const impactSpeed = physics.vy;
          const wasFalling = controller.state === STATES.FALLING;

          if (hopDown) {
            // Jumped down on purpose: a light landing, no dizzy spell.
            hopDown = false;
            physics.vy = 0;
            physics.vx = 0;
            send('pet:impact-effect');
            controller.transition(STATES.IDLE);
          } else if (wasFalling || impactSpeed > 6) {
            physics.vy = 0;
            physics.vx *= 0.3;
            controller.transition(STATES.IMPACT);
            send('pet:impact-effect');
            send('pet:impact-sound');
          } else if (impactSpeed > 2.5) {
            // Soft landing bounce
            physics.vy = -impactSpeed * 0.15;
            physics.vx *= 0.6;
          } else {
            physics.vy = 0;
            physics.vx *= 0.6;
          }
        }
      } else {
        pos.y = gy;
        physics.vy = 0;
      }

      // 2. Horizontal Locomotion & Human Gait Physics
      const isWalkingOrRunning = controller.isMoving && animationMode() === 'full';
      const cruiseSpeed = controller.state === STATES.RUNNING ? SPEED.RUNNING : SPEED.WALKING;

      // Boundary handling: turn around smoothly
      if (pos.x <= minX && dir < 0) {
        pos.x = minX;
        setDir(1);
        physics.vx = 0;
      } else if (pos.x >= maxX && dir > 0) {
        pos.x = maxX;
        setDir(-1);
        physics.vx = 0;
      }

      if (isWalkingOrRunning && !isAirborne) {
        physics.targetVx = dir * cruiseSpeed;
      } else if (!isAirborne) {
        physics.targetVx = 0;
      }

      // Inertia: smooth acceleration and deceleration
      if (physics.targetVx !== 0) {
        if (Math.sign(physics.vx) !== Math.sign(physics.targetVx) && Math.abs(physics.vx) > 0.1) {
          // Braking before changing direction
          const step = Math.min(Math.abs(physics.vx), physics.decel);
          physics.vx -= Math.sign(physics.vx) * step;
        } else {
          // Accelerating towards target speed
          const diff = physics.targetVx - physics.vx;
          const step = Math.min(Math.abs(diff), physics.accel);
          physics.vx += Math.sign(diff) * step;
        }
      } else {
        // Decelerating to a stop with ground friction
        const step = Math.min(Math.abs(physics.vx), physics.decel);
        physics.vx -= Math.sign(physics.vx) * step;
        if (Math.abs(physics.vx) < 0.05) physics.vx = 0;
      }

      // Biomechanical Step Modulation (footstep push-off & gait bobbing)
      if (Math.abs(physics.vx) > 0.1 && !isAirborne) {
        const cadenceFactor = Math.abs(physics.vx) / SPEED.WALKING;
        physics.gaitPhase += 0.22 * Math.min(cadenceFactor, 1.8);
        if (physics.gaitPhase > Math.PI * 2) physics.gaitPhase -= Math.PI * 2;

        // Propulsion pulse: forward speed pulses with each foot push-off
        const gaitImpulse = 1.0 + 0.22 * Math.cos(2 * physics.gaitPhase);
        pos.x += physics.vx * gaitImpulse;

        // Inverted-pendulum gait: center of mass rises at mid-stance
        const yGaitBob = -2.2 * Math.abs(Math.sin(physics.gaitPhase));
        pos.y = gy + yGaitBob;
      } else {
        pos.x += physics.vx;
        if (!isAirborne) physics.gaitPhase = 0;
      }

      // Keep visual CSS in sync with physical movement (avoid overriding emotional states)
      const visualCss = (Math.abs(physics.vx) > 0.2 && !EMOTIONAL_STATES.includes(controller.state))
        ? (controller.state === STATES.RUNNING ? 'run' : 'walk')
        : controller.css;
      if (visualCss !== lastSentCss) {
        lastSentCss = visualCss;
        send('pet:state', { css: visualCss, dir });
      }

      // Clamp x within display bounds
      pos.x = Math.max(minX, Math.min(maxX, pos.x));
    }
    apply();
  }

  let ambientCountdown = 2;
  // Ambient behaviour + timed-state expiry, once a second.
  // Hovering the buddy stops it where it is (reminders and the tour keep going).
  function holdStill() {
    if (drag || controller.reminderActive || tourHome || !controller.isMoving) return;
    target = null;
    physics.targetVx = 0;
    physics.vx = 0;
    controller.transition(STATES.IDLE);
    ambientCountdown = 4;
  }

  function think() {
    if (!alive() || !win.isVisible()) return;
    controller.tick();
    watchPerch();
    const h = new Date().getHours();
    const night = h >= 23 || h < 7;
    const idleSec = powerMonitor.getSystemIdleTime();
    const isEmotional = EMOTIONAL_STATES.includes(controller.state);

    // Naps: when the user is away, and at night once things go quiet.
    if (idleSec >= AFK_SECONDS) afk = true;
    else if (afk && idleSec < 2) {
      afk = false;
      if (controller.state === STATES.SLEEPING && !sleepingByUser) {
        controller.wake();
        controller.transition(STATES.WAVING);
        onWake('back');
        ensureLoop();
        return;
      }
    }
    const sleepy = sleepingByUser || afk || (night && idleSec >= NIGHT_IDLE_SECONDS);

    if (sleepy && controller.state !== STATES.SLEEPING && !controller.reminderActive && !drag && !target) {
      controller.sleep();
    } else if (!sleepy && controller.state === STATES.SLEEPING) {
      controller.wake();
      onWake('morning');
    } else if (!controller.reminderActive && !drag && !target && !controller.until && controller.state !== STATES.SLEEPING && !isEmotional) {
      // Late evening and night: yawn every now and then.
      if ((h >= 21 || h < 7) && Date.now() - lastYawn > 45_000 && Math.random() < 0.06) {
        lastYawn = Date.now();
        send('pet:mannerism', 'yawn');
      }
      if (maybeChase() || maybePerch()) { ensureLoop(); return; }
      // Stay put and watch while the cursor is close.
      if (look && controller.state !== STATES.WALKING) { ensureLoop(); return; }
      // Stay put while hovered.
      if (overBuddy) { holdStill(); ensureLoop(); return; }
      ambientCountdown--;
      if (ambientCountdown <= 0) {
        if (controller.state === STATES.WALKING) {
          // Finished stroll, pause and look around or idle for 3-5 seconds
          const r = Math.random();
          controller.transition(r < 0.6 ? STATES.IDLE : r < 0.85 ? STATES.LOOKING_AROUND : STATES.SITTING);
          ambientCountdown = 3 + Math.floor(Math.random() * 3);
        } else {
          // Done resting, stroll across desktop for 4-7 seconds with active steps
          if (animationMode() === 'full') {
            if (Math.random() < 0.45) setDir(-dir);
            controller.transition(STATES.WALKING);
            ambientCountdown = 4 + Math.floor(Math.random() * 4);
          } else {
            controller.pickAmbient();
            ambientCountdown = 4;
          }
        }
      }
    }
    ensureLoop();
  }
  let sleepingByUser = false;

  // ---------- chasing the cursor
  // A moving cursor nearby (but outside the "watch" range) sometimes gets
  // chased. The buddy stops short of it and then watches it.
  function maybeChase() {
    if (!settings.get('followCursor') || animationMode() !== 'full' || look) return false;
    if (Date.now() - lastChase < 8000 || Date.now() - lastCursor.movedAt > 1500 || Math.random() > 0.35) return false;
    const { w, h } = dims();
    const cx = pos.x + w / 2;
    const feet = pos.y + h - FOOT * size;
    const dx = lastCursor.x - cx;
    if (Math.abs(dx) > CHASE_RANGE || Math.abs(dx) < LOOK_RANGE || lastCursor.y > feet + 20 || feet - lastCursor.y > 260) return false;
    const { minX, maxX } = bounds();
    const stopShort = Math.sign(dx) * 70 * size;
    const x = Math.min(maxX, Math.max(minX, lastCursor.x - stopShort - w / 2));
    if (Math.abs(x - pos.x) < 20) return false;
    lastChase = Date.now();
    setDir(dx > 0 ? 1 : -1);
    controller.transition(Math.abs(dx) > 250 ? STATES.RUNNING : STATES.WALKING);
    target = { x, y: groundY(), onArrive: () => { controller.transition(STATES.IDLE); ambientCountdown = 4; } };
    return true;
  }

  // ---------- sitting on top of other windows
  function toDip(r) {
    const phys = { x: r.x, y: r.y, width: r.w, height: r.h };
    const d = process.platform === 'win32' ? screen.screenToDipRect(null, phys) : phys;
    return { left: d.x, top: d.y, right: d.x + d.width, width: d.width, height: d.height };
  }

  function suitable(r) {
    if (!r || r.pid === process.pid || r.maximized) return null;
    const box = toDip(r);
    const area = screen.getDisplayNearestPoint({ x: Math.round(box.left + box.width / 2), y: Math.round(box.top) }).workArea;
    const tall = 130 * size;
    if (box.width < 260 || box.height < 160) return null;
    if (box.top < area.y + tall || box.top > area.y + area.height - tall) return null;
    return box;
  }

  let perchBusy = false;
  function maybePerch() {
    if (perch || perchBusy || !settings.get('perchOnWindows') || animationMode() !== 'full') return false;
    if (Math.random() > 1 / 75) return false; // roughly every minute or two
    perchBusy = true;
    probe.foreground().then((r) => {
      perchBusy = false;
      const box = suitable(r);
      if (!box || !alive() || drag || target || controller.reminderActive || controller.state === STATES.SLEEPING) return;
      const { w, h } = dims();
      const margin = 45 * size;
      const x = Math.min(Math.max(pos.x, box.left + margin - w / 2), box.right - margin - w / 2);
      const y = box.top - h + FOOT * size;
      setDir(x + w / 2 > pos.x + w / 2 ? 1 : -1);
      controller.transition(STATES.RUNNING);
      target = {
        x, y,
        onArrive: () => {
          perch = { hwnd: r.hwnd, top: box.top, left: box.left, right: box.right, until: Date.now() + 40_000 + Math.random() * 80_000 };
          controller.transition(STATES.SITTING);
          ambientCountdown = 6;
        },
      };
      ensureLoop();
    }).catch(() => { perchBusy = false; });
    return false;
  }

  // While perched: follow the window when it moves, fall when it goes away,
  // and hop down after a while.
  let perchCheck = 0;
  function watchPerch() {
    if (!perch || perchBusy || drag) return;
    if (Date.now() > perch.until && !target && !controller.reminderActive) { leavePerch(true); return; }
    if (++perchCheck % 2) return;
    perchBusy = true;
    const was = perch;
    probe.rect(was.hwnd).then((r) => {
      perchBusy = false;
      if (perch !== was) return;
      const box = r && !r.gone && !r.maximized ? toDip(r) : null;
      if (!box) { leavePerch(false); return; }
      const dx = box.left - was.left;
      perch = { ...was, top: box.top, left: box.left, right: box.right };
      if (Math.abs(dx) > 1) pos.x += dx;
      clampToDisplay();
      ensureLoop();
    }).catch(() => { perchBusy = false; });
  }

  function leavePerch(onPurpose) {
    if (!perch) return;
    perch = null;
    if (onPurpose) {
      hopDown = true;
      physics.vy = -6;
      physics.vx = dir * 1.5;
      controller.transition(STATES.IDLE);
    } else {
      hopDown = false;
      controller.transition(STATES.FALLING);
      if (Math.random() < 0.7) send('pet:say', { text: 'Whoa! Where did it go?!', ms: 1400 });
    }
    ensureLoop();
  }

  // ---------- watching the cursor
  // Cursor within ≈3 cm of the buddy: turn towards it and point the head and
  // eyes at it. Offsets are sent in CSS px relative to the head.
  function trackCursor(c) {
    if (c.x !== lastCursor.x || c.y !== lastCursor.y) lastCursor = { x: c.x, y: c.y, movedAt: Date.now() };
    if (!hitbox || !settings.get('followCursor')) { setLook(null); return; }
    const left = pos.x + hitbox.x * size;
    const top = pos.y + hitbox.y * size;
    const right = left + hitbox.w * size;
    const bottom = top + hitbox.h * size;
    const gap = Math.hypot(Math.max(left - c.x, 0, c.x - right), Math.max(top - c.y, 0, c.y - bottom));
    const busy = drag || controller.reminderActive || controller.state === STATES.SLEEPING || EMOTIONAL_STATES.includes(controller.state);
    if (gap > LOOK_RANGE || busy) { setLook(null); return; }
    const headX = (left + right) / 2 + dir * hitbox.w * size * 0.22;
    const headY = top + hitbox.h * size * 0.3;
    const dx = (c.x - headX) / size;
    const dy = (c.y - headY) / size;
    // Turn round to face a cursor behind the buddy. Measured from the body's
    // centre, which doesn't move on turning (the head does, so measuring from
    // it made a cursor near the middle flip the buddy back and forth forever),
    // with a dead zone and a short cooldown between turns.
    const fromCentre = (c.x - (left + right) / 2) / size;
    if (CALM.includes(controller.state) && !target && Math.sign(fromCentre) !== dir && Math.abs(fromCentre) > 30
        && Date.now() - lastTurnAt > TURN_COOLDOWN_MS) {
      lastTurnAt = Date.now();
      setDir(Math.sign(fromCentre));
    }
    setLook({ dx: Math.round(dx), dy: Math.round(dy), inside: gap === 0 });
  }

  function setLook(v) {
    if (!v && !look) return;
    if (v && look && Math.abs(v.dx - look.dx) < 3 && Math.abs(v.dy - look.dy) < 3 && v.inside === look.inside) return;
    look = v;
    send('pet:look', v);
  }

  function sendOptions() {
    const s = settings.getAll();
    const isPaused = settings.get('buddyHidden') || !alive();
    send('pet:options', {
      animation: animationMode(), paused: isPaused, sound: s.sound, volume: s.volume, speech: s.speech, voice: s.voice,
      chimeStyle: s.chimeStyle, progressSign: s.progressSign,
    });
  }

  function create() {
    const { w, h } = dims();
    const primary = screen.getPrimaryDisplay();
    const saved = settings.get('position');
    const savedDisplay = saved && Number.isFinite(saved?.x) && screen.getAllDisplays().find((d) => d.id === saved.displayId);
    const d = savedDisplay || primary;
    const workArea = d?.workArea || { x: 0, y: 0, width: 1920, height: 1080 };
    pos.x = (savedDisplay && Number.isFinite(saved?.x)) ? saved.x : workArea.x + workArea.width - w - 60;
    pos.y = workArea.y + workArea.height - h;

    win = new BrowserWindow({
      width: w, height: h, x: Math.round(pos.x), y: Math.round(pos.y),
      show: false, transparent: true, frame: false, resizable: false, hasShadow: false,
      skipTaskbar: true, alwaysOnTop: true, focusable: true, fullscreenable: false, maximizable: false,
      title: 'Desktop Buddy',
      webPreferences: {
        preload: path.join(__dirname, '../preload/pet.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
        spellcheck: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.loadFile(path.join(__dirname, '../pet/pet.html'));

    // Closing hides the buddy; only an explicit exit quits.
    win.on('close', (e) => {
      if (app.isQuitting) return;
      e.preventDefault();
      hide();
    });
    win.on('show', sendOptions);
    win.on('hide', sendOptions);
    win.webContents.on('render-process-gone', (_e, details) => {
      log.error('pet renderer crashed', { reason: details.reason });
      if (!app.isQuitting) setTimeout(() => alive() && win.reload(), 2000);
    });

    brain = setInterval(think, 1000);
    // Click-through windows get no drag events, so when the cursor reaches the
    // buddy (for example while dragging text from a browser) make it catchable.
    // The renderer turns click-through back on when the cursor leaves.
    // The same poll drives cursor watching.
    hover = setInterval(() => {
      if (!alive() || !win.isVisible() || !hitbox) return;
      const c = screen.getCursorScreenPoint();
      const x = (c.x - pos.x) / size;
      const y = (c.y - pos.y) / size;
      const inside = x >= hitbox.x && x <= hitbox.x + hitbox.w && y >= hitbox.y && y <= hitbox.y + hitbox.h;
      if (inside && !overBuddy) {
        win.setIgnoreMouseEvents(false);
        holdStill();
      }
      overBuddy = inside;
      trackCursor(c);
    }, 60);
    screen.on('display-removed', clampToDisplay);
    screen.on('display-added', clampToDisplay);
    screen.on('display-metrics-changed', clampToDisplay);
  }

  // ---------- IPC from the pet renderer (only accepted from this window)
  const fromPet = (handler) => (e, payload) => { if (alive() && e.sender === win.webContents) handler(payload); };

  ipcMain.on('pet:ready', fromPet(() => {
    win.webContents.setZoomFactor(size);
    sendCharacter();
    // During onboarding the buddy stays off screen until walkIn() brings it on.
    if (!settings.get('buddyHidden') && !holdEntrance()) win.showInactive();
    sendOptions();
    lastSentCss = controller.css;
    send('pet:state', { css: controller.css, dir });
    if (lastMood) send('pet:mood', lastMood);
    if (lastDecor) send('pet:decor', lastDecor);
    ensureLoop();
    onReady();
  }));
  ipcMain.on('pet:set-ignore', fromPet((ignore) => win.setIgnoreMouseEvents(!!ignore, { forward: true })));
  ipcMain.on('pet:hitbox', fromPet((r) => {
    if (r && [r.x, r.y, r.w, r.h].every(Number.isFinite)) hitbox = { x: r.x, y: r.y, w: r.w, h: r.h };
  }));
  ipcMain.handle('pet:drop', (e, p) => {
    if (!alive() || e.sender !== win.webContents || !p) return null;
    return onDropText(typeof p.text === 'string' ? p.text : '', typeof p.uri === 'string' ? p.uri : '');
  });
  ipcMain.on('pet:reduced-motion', fromPet((v) => { reducedMotion = !!v; sendOptions(); }));
  ipcMain.on('pet:menu', fromPet(() => onMenu(win)));
  const ANGRY_SPEECHES = [
    'Hey!',
    'What was that?!',
    'Stop poking me!',
    'Hmph!',
    'Do you mind?!',
    'Hey, watch it!',
  ];
  const FALLING_SPEECHES = ['Whoa!', 'Ahhh!', 'Oh no!', 'Whooooa!'];

  const LOVED_SPEECHES = ['Hehe!', '♥', 'That tickles!', 'Aww, thanks!', '*happy wiggle*'];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function triggerAngryReaction(clicks = 3) {
    if (!alive() || !win.isVisible()) return;
    if (controller.reminderActive || drag) return;
    controller.transition(STATES.ANGRY);
    send('pet:angry-sound');
    if (clicks >= 6) send('pet:say', { text: 'OK, that’s ENOUGH clicking! 😤', ms: 1800 });
    else if (Math.random() < 0.75) send('pet:say', { text: pick(ANGRY_SPEECHES), ms: 1400 });
    ensureLoop();
  }

  // Petting: a single click or stroking the buddy with the mouse.
  let lastLoved = 0;
  function loved({ quiet = false } = {}) {
    if (!alive() || !win.isVisible() || controller.reminderActive || drag) return;
    if (controller.state === STATES.SLEEPING) { send('pet:hearts'); return; } // purrs in its sleep
    if (Date.now() - lastLoved < 1500 && controller.state === STATES.LOVED) return;
    lastLoved = Date.now();
    controller.transition(STATES.LOVED);
    send('pet:purr');
    if (!quiet && Math.random() < 0.6) send('pet:say', { text: pick(LOVED_SPEECHES), ms: 1400 });
    onPetted();
    ensureLoop();
  }
  ipcMain.on('pet:petted', fromPet(() => loved({ quiet: Math.random() < 0.5 })));

  ipcMain.on('pet:drag-start', fromPet(() => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    const c = screen.getCursorScreenPoint();
    drag = { offX: c.x - pos.x, offY: c.y - pos.y, startX: c.x, startY: c.y, lastX: c.x, lastY: c.y, moved: false };
    target = null;
    hopDown = false;
    setLook(null);
    physics.dragSamples = [{ x: c.x, y: c.y, t: Date.now() }];
    physics.vx = 0;
    physics.vy = 0;
    physics.gaitPhase = 0;
    physics.dragTilt = 0;
    controller.transition(STATES.DRAGGING);
    ensureLoop();
  }));
  ipcMain.on('pet:drag-end', fromPet(() => {
    if (!drag) return;
    const wasClick = !drag.moved;
    drag = null;

    if (wasClick) {
      // Not really dragged: back to whatever it was doing (or sleeping).
      controller.drop();
      // Count quick clicks, then react once the burst ends:
      //   1 → a happy little reaction, 2 → open the task manager, 3+ → annoyed.
      // drag-start (each mousedown) cancels the pending timer, so the count
      // comes from the timing alone.
      const now = Date.now();
      clickCount = now - lastClickTime <= 380 ? clickCount + 1 : 1;
      lastClickTime = now;
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        clickTimer = null;
        const n = clickCount;
        clickCount = 0;
        lastClickTime = 0;
        if (controller.state === STATES.SLEEPING) {
          sleepingByUser = false;
          afk = false;
          controller.wake();
          if (n === 1) { send('pet:say', { text: '*yawn* …I’m up, I’m up!', ms: 1800 }); return; }
        }
        if (n === 1) loved();
        else if (n === 2) { if (!controller.reminderActive) onClick(); }
        else triggerAngryReaction(n);
      }, 380);
      return;
    }

    // Dropped after dragging:
    const d = display();
    const gy = groundY(d);
    const dropHeight = gy - pos.y;
    const isHighDrop = dropHeight > 25;

    controller.drop({ airborne: isHighDrop });

    if (isHighDrop && dropHeight > 80 && Math.random() < 0.65) {
      const speech = FALLING_SPEECHES[Math.floor(Math.random() * FALLING_SPEECHES.length)];
      send('pet:say', { text: speech, ms: 1100 });
    }

    // Calculate throw / release velocity
    if (physics.dragSamples.length >= 2) {
      const first = physics.dragSamples[0];
      const last = physics.dragSamples[physics.dragSamples.length - 1];
      const dt = Math.max(16, last.t - first.t);
      const throwVx = ((last.x - first.x) / dt) * TICK_MS;
      const throwVy = ((last.y - first.y) / dt) * TICK_MS;
      physics.vx = Math.max(-14, Math.min(14, throwVx * 0.7));
      physics.vy = Math.max(-16, Math.min(10, throwVy * 0.7));
    }
    physics.dragSamples = [];

    if (controller.reminderActive) home = { x: pos.x, displayId: display().id };
    else settings.update({ position: { x: Math.round(pos.x), displayId: display().id } });
    if (tourHome) tourHome = { x: pos.x };
    ensureLoop();
    onDragged();
  }));
  ipcMain.handle('pet:hint', (e) => (alive() && e.sender === win.webContents ? hint() : null));

  // ---------- public API
  function show() {
    if (!alive()) return;
    win.showInactive();
    settings.update({ buddyHidden: false });
    sendOptions();
    clampToDisplay();
    ensureLoop();
  }

  function hide() {
    if (!alive()) return;
    win.hide();
    settings.update({ buddyHidden: true });
    sendOptions();
    perch = null;
    if (loop) { clearInterval(loop); loop = null; }
  }

  function startReminder({ center }) {
    if (!alive()) return;
    win.moveTop();
    perch = null;
    setLook(null);
    controller.transition(STATES.REMINDER);
    home = { x: pos.x, displayId: display().id };
    if (!center) return;
    const d = display().workArea;
    const { w, h } = dims();
    controller.transition(STATES.RUNNING);
    target = {
      x: d.x + (d.width - w) / 2,
      y: d.y + (d.height - h) / 2,
      onArrive: () => controller.transition(STATES.REMINDER),
    };
    ensureLoop();
  }

  function endReminder({ celebrate }) {
    controller.resolveReminder({ celebrate });
    if (home) {
      const backTo = home;
      home = null;
      const d = screen.getAllDisplays().find((x) => x.id === backTo.displayId) || display();
      target = { x: backTo.x, y: d.workArea.y + d.workArea.height - dims().h };
      ensureLoop();
    }
  }

  const sendCharacter = () => send('pet:character', { id: settings.get('character'), accessory: settings.get('accessory') });

  function applySettings(patch) {
    if ('characterSize' in patch) {
      size = settings.get('characterSize');
      const { w, h } = dims();
      win.setBounds({ x: Math.round(pos.x), y: Math.round(pos.y), width: w, height: h });
      win.webContents.setZoomFactor(size);
      clampToDisplay();
    }
    if ('character' in patch || 'accessory' in patch) sendCharacter();
    if (['animation', 'sound', 'volume', 'speech', 'voice', 'chimeStyle', 'progressSign'].some((k) => k in patch)) sendOptions();
  }

  // ---------- onboarding choreography
  // Walk in from the right edge of the screen to the usual spot, then wave.
  function walkIn({ onArrive } = {}) {
    if (!alive()) return;
    const d = display().workArea;
    const { w } = dims();
    const homeX = pos.x;
    perch = null;
    pos.x = d.x + d.width + 10;
    pos.y = groundY();
    lastPos = '';
    apply();
    win.showInactive();
    settings.update({ buddyHidden: false });
    sendOptions();
    if (controller.state === STATES.SLEEPING) controller.wake();
    setDir(-1);
    controller.transition(STATES.WALKING);
    ambientCountdown = 99;
    target = {
      x: Math.min(homeX, d.x + d.width - w - 20),
      y: groundY(),
      onArrive: () => { ambientCountdown = 4; controller.transition(STATES.WAVING); onArrive?.(); },
    };
    ensureLoop();
  }

  // Stroll to the bottom-right corner (next to the tray) or back to where it was.
  function goTo(where, { onArrive } = {}) {
    if (!alive() || !win.isVisible() || drag) return;
    perch = null;
    let x;
    if (where === 'tray') {
      if (!tourHome) tourHome = { x: pos.x };
      const d = screen.getPrimaryDisplay().workArea;
      x = d.x + d.width - dims().w + 50;
    } else {
      if (!tourHome) { onArrive?.(); return; }
      x = tourHome.x;
      tourHome = null;
    }
    if (Math.abs(x - pos.x) < 4) { setDir(where === 'tray' ? 1 : -1); onArrive?.(); return; }
    setDir(x > pos.x ? 1 : -1);
    controller.transition(STATES.WALKING);
    ambientCountdown = 99;
    target = {
      x, y: groundY(),
      onArrive: () => {
        ambientCountdown = 4;
        if (where === 'tray') setDir(1);
        controller.transition(STATES.IDLE);
        if (where !== 'tray') settings.update({ position: { x: Math.round(pos.x), displayId: display().id } });
        onArrive?.();
      },
    };
    ensureLoop();
  }

  function wave() {
    if (!alive() || controller.reminderActive) return;
    if (controller.state === STATES.SLEEPING) controller.wake();
    controller.transition(STATES.WAVING);
  }

  function setSleeping(v) {
    sleepingByUser = v;
    if (!v) afk = false;
    if (v) controller.sleep(); else controller.wake();
  }

  function destroy() {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    clearInterval(loop);
    clearInterval(brain);
    clearInterval(hover);
    probe.dispose();
    screen.removeListener('display-removed', clampToDisplay);
    screen.removeListener('display-added', clampToDisplay);
    screen.removeListener('display-metrics-changed', clampToDisplay);
  }

  create();

  return {
    show, hide, destroy, startReminder, endReminder, applySettings, setSleeping, walkIn, goTo, wave,
    isVisible: () => alive() && win.isVisible(),
    isSleeping: () => controller.state === STATES.SLEEPING,
    send,
    // Hop for joy and say something, unless a reminder is on screen.
    celebrate(text) {
      if (!alive() || !win.isVisible() || controller.reminderActive) return;
      if (controller.state === STATES.SLEEPING) controller.wake();
      controller.transition(STATES.CELEBRATING);
      send('pet:say', { text, ms: 4000 });
    },
    speak(text, ms) {
      if (!alive() || !win.isVisible()) return;
      if (!controller.reminderActive) controller.transition(STATES.SPEAKING);
      send('pet:say', { text, ms });
    },
    // Sits quietly during focus mode (resets ambient wander countdown)
    sit() {
      if (!alive() || !win.isVisible() || controller.reminderActive) return;
      if (controller.state === STATES.SLEEPING) controller.wake();
      controller.transition(STATES.SITTING);
      ambientCountdown = 60;
    },
    // Stretches with user on break
    stretch() {
      if (!alive() || !win.isVisible() || controller.reminderActive) return;
      if (controller.state === STATES.SLEEPING) controller.wake();
      send('pet:state', { css: 'stretch', dir });
      setTimeout(() => {
        if (alive() && !controller.reminderActive) controller.transition(STATES.IDLE);
      }, 3500);
    },
    // Munch a treat (the caller has already spent it).
    eat(text) {
      if (!alive() || !win.isVisible() || controller.reminderActive) return false;
      if (controller.state === STATES.SLEEPING) { sleepingByUser = false; afk = false; controller.wake(); }
      controller.transition(STATES.EATING);
      send('pet:eat');
      if (text) setTimeout(() => send('pet:say', { text, ms: 2500 }), 1600);
      return true;
    },
    // Mood ({ level, hungry }) and decorations ({ season, weather }) for the renderer.
    setMood: (m) => { lastMood = m; send('pet:mood', m); },
    setDecor: (d) => { lastDecor = d; send('pet:decor', d); },
    get window() { return win; },
  };
}

module.exports = { createPetWindow };
