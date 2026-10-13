// The transparent buddy window: position, movement, dragging and animation
// state. Movement runs only while something is actually moving, and stops
// entirely while the buddy is hidden.
const path = require('path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { AnimationController, STATES } = require('../pet/controller');

const BASE_W = 340;
const BASE_H = 400;
const TICK_MS = 33;
const SPEED = { WALKING: 2, RUNNING: 7, glide: 6 };

function createPetWindow({ settings, log, onClick, onMenu, onReady, hint, onDropText }) {
  let win = null;
  let size = settings.get('characterSize');
  let reducedMotion = false;
  let loop = null;
  let brain = null;
  let drag = null;
  let target = null;        // { x, y, onArrive } for runs to the centre and back
  let home = null;          // where to return after a reminder
  let lastPos = '';
  let lastSentCss = '';
  let hitbox = null;        // the buddy's box inside the window, in CSS px
  let overBuddy = false;
  let hover = null;
  const pos = { x: 0, y: 0 };
  let dir = -1;
  let clickTimer = null;
  let lastClickTime = 0;
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
  const groundY = (d = display()) => d.workArea.y + d.workArea.height - dims().h;

  function clampToDisplay() {
    const d = display();
    const { w } = dims();
    const area = d?.workArea || { x: 0, y: 0, width: 1920, height: 1080 };
    const minX = area.x - 60;
    const maxX = area.x + area.width - w + 60;
    if (!Number.isFinite(pos.x)) pos.x = maxX - 60;
    pos.x = Math.min(Math.max(pos.x, minX), maxX);
    if (!drag && !target) {
      pos.y = groundY(d);
      physics.vy = 0;
    }
    if (!Number.isFinite(pos.y)) pos.y = groundY(d);
    apply();
  }

  function apply() {
    if (!alive()) return;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      clampToDisplay();
      return;
    }
    const rx = Math.round(pos.x);
    const ry = Math.round(pos.y);
    const key = `${rx},${ry}`;
    if (key === lastPos) return;
    lastPos = key;
    win.setPosition(rx, ry);
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
    const { w } = dims();
    const minX = d.workArea.x - 60;
    const maxX = d.workArea.x + d.workArea.width - w + 60;

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
      if (Math.abs(c.x - drag.startX) + Math.abs(c.y - drag.startY) > 6) drag.moved = true;
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

          if (wasFalling || impactSpeed > 6) {
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
  function think() {
    if (!alive() || !win.isVisible()) return;
    controller.tick();
    const h = new Date().getHours();
    const night = h >= 23 || h < 7;
    const isEmotional = EMOTIONAL_STATES.includes(controller.state);
    if ((night || sleepingByUser) && controller.state !== STATES.SLEEPING && !controller.reminderActive && !drag) {
      controller.sleep();
    } else if (!night && !sleepingByUser && controller.state === STATES.SLEEPING) {
      controller.wake();
    } else if (!controller.reminderActive && !drag && controller.state !== STATES.SLEEPING && !isEmotional) {
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

  function sendOptions() {
    const s = settings.getAll();
    const isPaused = settings.get('buddyHidden') || !alive();
    send('pet:options', {
      animation: animationMode(), paused: isPaused, sound: s.sound, volume: s.volume, speech: s.speech, voice: s.voice,
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
    hover = setInterval(() => {
      if (!alive() || !win.isVisible() || !hitbox) return;
      const c = screen.getCursorScreenPoint();
      const x = (c.x - pos.x) / size;
      const y = (c.y - pos.y) / size;
      const inside = x >= hitbox.x && x <= hitbox.x + hitbox.w && y >= hitbox.y && y <= hitbox.y + hitbox.h;
      if (inside && !overBuddy) win.setIgnoreMouseEvents(false);
      overBuddy = inside;
    }, 100);
    screen.on('display-removed', clampToDisplay);
    screen.on('display-added', clampToDisplay);
    screen.on('display-metrics-changed', clampToDisplay);
  }

  // ---------- IPC from the pet renderer (only accepted from this window)
  const fromPet = (handler) => (e, payload) => { if (alive() && e.sender === win.webContents) handler(payload); };

  ipcMain.on('pet:ready', fromPet(() => {
    win.webContents.setZoomFactor(size);
    send('pet:character', settings.get('character'));
    if (!settings.get('buddyHidden')) win.showInactive();
    sendOptions();
    lastSentCss = controller.css;
    send('pet:state', { css: controller.css, dir });
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

  function triggerAngryReaction() {
    if (!alive() || !win.isVisible()) return;
    if (controller.reminderActive || drag) return;
    controller.transition(STATES.ANGRY);
    send('pet:angry-sound');
    if (Math.random() < 0.75) {
      const speech = ANGRY_SPEECHES[Math.floor(Math.random() * ANGRY_SPEECHES.length)];
      send('pet:say', { text: speech, ms: 1400 });
    }
    ensureLoop();
  }

  ipcMain.on('pet:drag-start', fromPet(() => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    const c = screen.getCursorScreenPoint();
    drag = { offX: c.x - pos.x, offY: c.y - pos.y, startX: c.x, startY: c.y, lastX: c.x, lastY: c.y, moved: false };
    target = null;
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
      const now = Date.now();
      const timeSinceLastClick = now - lastClickTime;
      lastClickTime = now;

      // drag-start (the second mousedown) already cancelled clickTimer, so
      // detect the double-click from the timing alone.
      if (timeSinceLastClick <= 350) {
        // Double-click detected! Open manager, cancel angry reaction
        clearTimeout(clickTimer);
        clickTimer = null;
        lastClickTime = 0;
        if (controller.state === STATES.SLEEPING) {
          sleepingByUser = false;
          controller.wake();
        }
        if (!controller.reminderActive) {
          onClick();
        }
        return;
      }

      // First click: queue single click angry reaction with a cancellable timer (300ms)
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        clickTimer = null;
        if (controller.state === STATES.SLEEPING) {
          sleepingByUser = false;
          controller.wake();
          return;
        }
        triggerAngryReaction();
      }, 300);
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
    ensureLoop();
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
    if (loop) { clearInterval(loop); loop = null; }
  }

  function startReminder({ center }) {
    if (!alive()) return;
    win.moveTop();
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

  function applySettings(patch) {
    if ('characterSize' in patch) {
      size = settings.get('characterSize');
      const { w, h } = dims();
      win.setBounds({ x: Math.round(pos.x), y: Math.round(pos.y), width: w, height: h });
      win.webContents.setZoomFactor(size);
      clampToDisplay();
    }
    if ('character' in patch) send('pet:character', settings.get('character'));
    if (['animation', 'sound', 'volume', 'speech', 'voice'].some((k) => k in patch)) sendOptions();
  }

  function setSleeping(v) {
    sleepingByUser = v;
    if (v) controller.sleep(); else controller.wake();
  }

  function destroy() {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    clearInterval(loop);
    clearInterval(brain);
    clearInterval(hover);
    screen.removeListener('display-removed', clampToDisplay);
    screen.removeListener('display-added', clampToDisplay);
    screen.removeListener('display-metrics-changed', clampToDisplay);
  }

  create();

  return {
    show, hide, destroy, startReminder, endReminder, applySettings, setSleeping,
    isVisible: () => alive() && win.isVisible(),
    isSleeping: () => controller.state === STATES.SLEEPING,
    send,
    speak(text, ms) {
      if (!alive() || !win.isVisible()) return;
      if (!controller.reminderActive) controller.transition(STATES.SPEAKING);
      send('pet:say', { text, ms });
    },
    get window() { return win; },
  };
}

module.exports = { createPetWindow };
