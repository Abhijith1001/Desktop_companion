// Intro section: a cat whose head follows the cursor. cat/35.webp … cat/212.webp
// are every frame of a head-turn video going clockwise from "up"
// round to "up-left"; POSES maps screen angles to those frames, so moving the
// cursor steps through neighbouring real frames instead of jumping between
// poses. center.webp looks straight at the viewer. One frame is drawn at a time.
(() => {
  const hero = document.getElementById('cat-hero');
  if (!hero) return;
  const FIRST = 35, LAST = 212, STEP = 1;
  // [screen angle in degrees (0 = right, 90 = down, 180 = left, 270 = up), video frame]
  const POSES = [[-90, 35], [-45, 68], [0, 90], [45, 112], [90, 145], [135, 168], [180, 195], [215, 212]];
  const GAP_FROM = 215;  // up-left → up has no frames; snap to the nearer end
  const TAU = Math.PI * 2;
  const DEADZONE = 0.1;  // fraction of the section's short side
  const SMOOTHING = 3.5; // how quickly the head catches up, per second (higher = snappier)
  const MAX_TURN = 2.6;  // fastest head turn in radians per second (~150°/s)
  const FACE_Y = 0.42;   // face centre as a fraction of frame height
  const SIZE = 0.9;      // frame height as a fraction of the section height
  const FRAME_W = 1060, FRAME_H = 720;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  const canvas = hero.querySelector('.cat-stage');
  const ctx = canvas.getContext('2d');
  const dot = hero.querySelector('.cat-cursor-dot');
  const ring = hero.querySelector('.cat-cursor-ring');

  // Every frame is decoded once into an ImageBitmap up front; drawing an
  // undecoded <img> makes the browser decode it mid-frame, which stutters.
  const bitmaps = {};
  const load = (key, src) => {
    const img = new Image();
    img.src = src;
    return img.decode()
      .then(() => (window.createImageBitmap ? createImageBitmap(img) : img))
      .then((bmp) => { bitmaps[key] = bmp; })
      .catch(() => {});
  };
  load('center', 'cat/center.webp').then(() => {
    last = null; render();
    // then the rest of the turn, six downloads at a time
    const order = [];
    for (let f = FIRST; f <= LAST; f += STEP) order.push(f);
    let i = 0;
    const next = () => { if (i < order.length) load(order[i], `cat/${order[i++]}.webp`).then(next); };
    for (let k = 0; k < 6; k++) next();
  });

  // Continuous angle → frame lookup.
  function frameFor(rad) {
    let a = rad * 180 / Math.PI;
    a = ((a + 90) % 360 + 360) % 360 - 90; // into [-90, 270)
    for (let i = 0; i < POSES.length - 1; i++) {
      const [a0, f0] = POSES[i], [a1, f1] = POSES[i + 1];
      if (a >= a0 && a <= a1) return Math.round(f0 + (f1 - f0) * (a - a0) / (a1 - a0));
    }
    return a - GAP_FROM < 270 - a ? LAST : FIRST;
  }
  // signed shortest difference b − a around the circle, in (−π, π]
  const angleDiff = (a, b) => ((((b - a) % TAU) + TAU * 1.5) % TAU) - Math.PI;

  let W = 0, H = 0, layout = null, last = null;
  let angle = Math.PI / 2;
  const mouse = { x: 0, y: 0, inside: false };
  const ringPos = { x: 0, y: 0 };
  // Scratch canvas: the frame is drawn there, its edges are faded to
  // transparent, and the result is laid over a gradient matching the video's
  // vignette, so there is no visible box.
  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d');

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = hero.clientWidth; H = hero.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = Math.max(H * SIZE / FRAME_H, W < 700 ? W / FRAME_W : 0);
    const w = FRAME_W * s, h = FRAME_H * s;
    const shift = W > 900 ? Math.min(W * 0.12, (W - w) / 2) : 0; // leave room for the copy
    const x = (W - w) / 2 + shift, y = H - h;
    layout = { x, y, w, h, fx: x + w / 2, fy: y + h * FACE_Y };
    scratch.width = Math.round(w * dpr); scratch.height = Math.round(h * dpr);
    last = null;
  }

  // Draws the directional frame with the straight-ahead frame faded over it
  // by `mix` (0…1). The two only overlap during the short fade in or out of
  // the centre zone, so there is no lasting double image.
  function drawFrame(img, mix = 0) {
    if (!img) return false;
    const { x, y, w, h } = layout;
    const sw = scratch.width, sh = scratch.height;

    // background: the same vignette the video has, centred on the frame
    const cx = x + w / 2, cy = y + h / 2;
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w * 0.62, Math.hypot(Math.max(cx, W - cx), H)));
    bg.addColorStop(0, '#e4170d');
    bg.addColorStop(0.45, '#d81109');
    bg.addColorStop(0.8, '#c90d07');
    bg.addColorStop(1, '#b40b06');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // frame with feathered sides and top
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, sw, sh);
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, sw, sh);
    if (mix > 0 && bitmaps.center && img !== bitmaps.center) {
      sctx.globalAlpha = mix;
      sctx.drawImage(bitmaps.center, 0, 0, sw, sh);
      sctx.globalAlpha = 1;
    }
    sctx.globalCompositeOperation = 'destination-in';
    const gx = sctx.createLinearGradient(0, 0, sw, 0);
    gx.addColorStop(0, 'rgba(0,0,0,0)');
    gx.addColorStop(0.07, 'rgba(0,0,0,1)');
    gx.addColorStop(0.93, 'rgba(0,0,0,1)');
    gx.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = gx;
    sctx.fillRect(0, 0, sw, sh);
    const gy = sctx.createLinearGradient(0, 0, 0, sh);
    gy.addColorStop(0, 'rgba(0,0,0,0)');
    gy.addColorStop(0.08, 'rgba(0,0,0,1)');
    sctx.fillStyle = gy;
    sctx.fillRect(0, 0, sw, sh);

    ctx.drawImage(scratch, x, y, w, h);
    return true;
  }


  // Frame-rate independent easing, so it feels the same at 60 Hz and 144 Hz.
  let prevT = 0;
  let lookingAtYou = true; // inside the centre zone (with hysteresis)
  let mix = 1;             // eased 0…1 weight of the straight-ahead frame
  let shown = '';          // what is on the canvas, to skip identical redraws
  function render(now = performance.now()) {
    const dt = Math.min(0.05, (now - (prevT || now)) / 1000);
    prevT = now;
    if (mouse.inside && !reduceMotion) {
      const dx = mouse.x - layout.fx, dy = mouse.y - layout.fy;
      const dist = Math.hypot(dx, dy), zone = Math.min(W, H) * DEADZONE;
      // enter at 1×, leave at 1.4×, so it can't flip at the edge
      lookingAtYou = dist < zone * (lookingAtYou ? 1.4 : 1);
      if (!lookingAtYou) {
        // shortest way round the circle, eased and speed-capped
        const step = angleDiff(angle, Math.atan2(dy, dx)) * (1 - Math.exp(-SMOOTHING * dt));
        const cap = MAX_TURN * dt;
        angle += Math.max(-cap, Math.min(cap, step));
        angle = Math.atan2(Math.sin(angle), Math.cos(angle));
      }
    } else {
      lookingAtYou = true;
    }
    mix += ((lookingAtYou ? 1 : 0) - mix) * (1 - Math.exp(-8 * dt)); // ~350 ms fade
    if (mix < 0.01) mix = 0; else if (mix > 0.99) mix = 1;

    let key = frameFor(angle);
    if (!bitmaps[key]) key = last ?? 'center'; // still loading: keep what we had
    const state = `${key}|${mix.toFixed(2)}`;
    if (state === shown && last !== null) return;
    const base = mix === 1 ? bitmaps.center : bitmaps[key];
    if (drawFrame(base, mix)) { shown = state; last = key; }
  }

  let running = false;
  function loop(now) {
    if (!running) return;
    render(now);
    if (finePointer && mouse.inside) {
      ringPos.x += (mouse.x - ringPos.x) * 0.18;
      ringPos.y += (mouse.y - ringPos.y) * 0.18;
      dot.style.transform = `translate(${mouse.x}px, ${mouse.y}px)`;
      ring.style.transform = `translate(${ringPos.x}px, ${ringPos.y}px)`;
    }
    requestAnimationFrame(loop);
  }

  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    if (!mouse.inside) { ringPos.x = mouse.x; ringPos.y = mouse.y; }
    mouse.inside = true;
    if (finePointer) hero.classList.add('cursor-on');
  });
  hero.addEventListener('pointerleave', () => { mouse.inside = false; hero.classList.remove('cursor-on'); });
  for (const el of hero.querySelectorAll('a, button')) {
    el.addEventListener('mouseenter', () => ring.classList.add('hover'));
    el.addEventListener('mouseleave', () => ring.classList.remove('hover'));
  }

  // Only animate while the section is on screen.
  new IntersectionObserver(([entry]) => {
    const was = running;
    running = entry.isIntersecting;
    if (running && !was) requestAnimationFrame(loop);
  }).observe(hero);

  addEventListener('resize', () => { resize(); render(); });
  resize();
})();
