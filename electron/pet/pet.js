// Pet window renderer. All decisions (state, position, reminders) are made in
// the main process; this file only draws, plays sound/speech and reports input.
(() => {
  const buddy = document.getElementById('buddy');
  const bubble = document.getElementById('bubble');
  const api = window.pet;

  let css = 'idle';
  let dir = 1;
  let character = 'dog';
  let options = { animation: 'full', paused: false, sound: true, volume: 0.6, speech: true, voice: '' };
  let alert = null;
  let dragging = false;
  let hovering = false;
  let sayTimer = null;
  let mannerism = '';
  let mood = { level: 'ok', hungry: false };
  let decor = { season: null, weather: null };
  let look = null;          // { dx, dy, inside } cursor offset from the head, CSS px
  let charPayload = { id: 'dog', accessory: null };
  let hot = false;          // the computer is struggling: angry, red and on fire

  // ---------- drawing
  function render() {
    const c = window.CHARACTERS[character] || window.CHARACTERS.dog;
    buddy.className = ['buddy', css, dir < 0 ? 'left' : '', c.upright ? 'upright' : '',
      options.animation === 'reduced' ? 'reduced' : '', options.animation === 'off' ? 'still' : '',
      options.paused ? 'paused' : '', mannerism ? `m-${mannerism}` : '',
      `mood-${mood.level}`, mood.hungry ? 'hungry' : '', hovering && !dragging ? 'hovered' : '',
      look?.inside ? 'curious' : '', decor.season ? `season-${decor.season}` : '', hot && !options.paused ? 'overheat' : ''].filter(Boolean).join(' ');
    applyLook();
    renderSprite();
    renderHeat();
    renderSign();
  }

  // ---------- sprite characters: swap the pose image to match state and mood
  const POSES = {
    walk: ['walk', 'run', 'drag', 'falling'],
    angry: ['angry', 'impact'],
    happy: ['happy', 'love', 'eat', 'wave'],
    warn: ['alert', 'dizzy', 'recovering'],
  };
  function spritePose() {
    if (hot && !options.paused) return 'angry';
    if (buddy.classList.contains('hearts')) return 'happy';
    for (const [pose, states] of Object.entries(POSES)) if (states.includes(css)) return pose;
    if (css === 'idle' && mood.level === 'happy') return 'happy';
    if (css === 'idle' && (mood.level === 'sulky' || mood.overdue)) return 'warn';
    return 'idle';
  }
  function renderSprite() {
    const img = buddy.querySelector('image.sprite');
    if (!img) return;
    const url = window.spriteUrl(character, spritePose());
    if (img.getAttribute('href') !== url) img.setAttribute('href', url);
  }

  // ---------- "N left today" sign, shown while the buddy is standing still
  const sign = document.getElementById('sign');
  let signText = '';
  function renderSign() {
    const left = mood.left || 0;
    const visible = options.progressSign && left > 0 && !options.paused && ['idle', 'sit'].includes(css) && !dragging;
    sign.classList.toggle('show', visible);
    const text = `${left} left today${mood.overdue ? '!' : ''}`;
    if (!visible || text === signText) return;
    const bumped = signText !== '';
    signText = text;
    const board = document.createElement('div');
    board.className = `board${mood.overdue ? ' late' : ''}`;
    board.textContent = text;
    const post = document.createElement('div');
    post.className = 'post';
    sign.replaceChildren(board, post);
    if (bumped) { sign.classList.remove('bump'); void sign.offsetWidth; sign.classList.add('bump'); }
  }

  // ---------- mannerisms: short cartoon quirks played now and then while idle
  const MANNERISMS = { doubletake: 1700, foottap: 1900, yawn: 2300, shifty: 1900, zip: 1200, huh: 1700 };
  let mannerismTimer = null;
  function scheduleMannerism() {
    clearTimeout(mannerismTimer);
    mannerismTimer = setTimeout(playMannerism, 8000 + Math.random() * 12000);
  }
  function playMannerism() {
    const calm = (css === 'idle' || css === 'sit') && !alert && !dragging && !sayTimer;
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!calm || options.animation !== 'full' || options.paused || reduceMotion) return scheduleMannerism();
    const names = Object.keys(MANNERISMS).filter((n) => n !== mannerism);
    mannerism = names[Math.floor(Math.random() * names.length)];
    render();
    mannerismTimer = setTimeout(() => { mannerism = ''; render(); scheduleMannerism(); }, MANNERISMS[mannerism]);
  }
  function stopMannerism() {
    if (!mannerism) return;
    mannerism = '';
    scheduleMannerism();
  }
  function setCharacter(p) {
    charPayload = typeof p === 'string' ? { id: p, accessory: null } : { accessory: null, ...p };
    const { id, accessory } = charPayload;
    character = window.CHARACTERS[id] ? id : 'dog';
    // December: a Santa hat, unless an unlocked accessory is being worn.
    const wear = accessory || (decor.season === 'christmas' ? 'santa' : null);
    buddy.innerHTML = window.buddyMarkup(character, wear);
    setupLook();
    render();
  }

  // ---------- watching the cursor
  // The head and eyes are wrapped in extra groups so the look can be layered
  // on top of whatever animation the head itself is playing.
  let lookHead = null;
  let lookEyes = null;
  function wrap(node, cls) {
    if (!node) return null;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', cls);
    node.parentNode.insertBefore(g, node);
    g.appendChild(node);
    return g;
  }
  function setupLook() {
    const head = buddy.querySelector('#head');
    lookHead = wrap(head, 'look-head');
    lookEyes = wrap(buddy.querySelector('#eye-open'), 'look-eyes');
    if (lookHead) {
      try {
        const b = head.getBBox();
        lookHead.style.transformOrigin = `${b.x + b.width / 2}px ${b.y + b.height}px`;
      } catch { /* not rendered yet */ }
    }
  }
  const STILL_HEAD = ['sleep', 'drag', 'falling', 'impact', 'dizzy', 'recovering', 'angry', 'eat'];
  function applyLook() {
    if (!lookHead) return;
    if (!look || STILL_HEAD.includes(css) || options.animation === 'off') {
      lookHead.style.transform = '';
      if (lookEyes) lookEyes.style.transform = '';
      return;
    }
    // In the SVG, +x is always "in front" (the whole picture is mirrored when
    // facing left), so flip the horizontal offset into that space.
    const fx = look.dx * dir;
    const dist = Math.max(1, Math.hypot(fx, look.dy));
    const clamp = (v, m) => Math.max(-m, Math.min(m, v));
    const tilt = clamp((Math.atan2(look.dy, Math.max(Math.abs(fx), 25)) * 180) / Math.PI * 0.55, -20, 20);
    const shiftX = clamp((fx / dist) * 3, -3, 3);
    const shiftY = clamp((look.dy / dist) * 2.5, -2.5, 2.5);
    lookHead.style.transform = `translate(${shiftX.toFixed(1)}px, ${shiftY.toFixed(1)}px) rotate(${tilt.toFixed(1)}deg)`;
    if (lookEyes) lookEyes.style.transform = `translate(${clamp((fx / dist) * 2.5, -2.5, 2.5).toFixed(1)}px, ${clamp((look.dy / dist) * 2.2, -2.2, 2.2).toFixed(1)}px)`;
  }

  // ---------- click-through: only the buddy and bubble catch the mouse
  const setIgnore = (v) => api.send('pet:set-ignore', v);
  for (const el of [buddy, bubble]) {
    el.addEventListener('mouseenter', () => {
      hovering = true;
      setIgnore(false);
      if (el === buddy) { showHint(); render(); }
    });
    el.addEventListener('mouseleave', () => {
      hovering = false;
      if (!dragging) setIgnore(true);
      if (el === buddy) { hideHint(); render(); }
    });
  }

  // ---------- petting: stroking back and forth over the buddy
  let stroke = { lastX: null, sign: 0, turns: 0, travel: 0, since: 0 };
  let lastPetted = 0;
  buddy.addEventListener('mousemove', (e) => {
    if (dragging || alert) return;
    const now = performance.now();
    if (stroke.lastX == null || now - stroke.since > 1600) stroke = { lastX: e.clientX, sign: 0, turns: 0, travel: 0, since: now };
    const dx = e.clientX - stroke.lastX;
    stroke.lastX = e.clientX;
    if (Math.abs(dx) < 2) return;
    stroke.travel += Math.abs(dx);
    const sign = Math.sign(dx);
    if (stroke.sign && sign !== stroke.sign) stroke.turns++;
    stroke.sign = sign;
    if (stroke.turns >= 3 && stroke.travel > 70 && now - lastPetted > 2500) {
      lastPetted = now;
      stroke = { lastX: null, sign: 0, turns: 0, travel: 0, since: 0 };
      hideHint();
      api.send('pet:petted');
    }
  });

  buddy.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    hideHint();
    api.send('pet:drag-start');
  });
  window.addEventListener('mouseup', (e) => {
    if (!dragging || e.button !== 0) return;
    dragging = false;
    api.send('pet:drag-end');
    if (!hovering) setIgnore(true);
  });
  buddy.addEventListener('contextmenu', (e) => { e.preventDefault(); api.send('pet:menu'); });

  // ---------- drop text on the buddy to save it as a bookmark
  // Main watches the cursor and turns off click-through when it reaches this
  // box, because a click-through window never sees drag events otherwise.
  const reportHitbox = () => {
    const r = buddy.getBoundingClientRect();
    api.send('pet:hitbox', { x: r.left, y: r.top, w: r.width, h: r.height });
  };
  new ResizeObserver(reportHitbox).observe(buddy);
  window.addEventListener('resize', reportHitbox);

  const TEXT_TYPES = ['text/plain', 'text/html', 'text/uri-list'];
  const hasText = (e) => TEXT_TYPES.some((t) => e.dataTransfer.types.includes(t));
  const htmlToText = (html) => {
    try { return new DOMParser().parseFromString(html, 'text/html').body.textContent || ''; } catch { return ''; }
  };
  const endDropHover = () => { buddy.classList.remove('drop-target'); if (!hovering) setIgnore(true); };
  buddy.addEventListener('dragenter', (e) => { if (hasText(e)) { e.preventDefault(); buddy.classList.add('drop-target'); } });
  buddy.addEventListener('dragover', (e) => {
    if (!hasText(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  buddy.addEventListener('dragleave', (e) => { if (!buddy.contains(e.relatedTarget)) endDropHover(); });
  buddy.addEventListener('drop', async (e) => {
    e.preventDefault();
    endDropHover();
    const dt = e.dataTransfer;
    const uri = (dt.getData('text/uri-list') || '').split('\n').find((l) => l && !l.startsWith('#'))?.trim() || '';
    const text = dt.getData('text/plain') || htmlToText(dt.getData('text/html')) || uri;
    try { await api.invoke('pet:drop', { text, uri }); } catch { /* main reports problems through the bubble */ }
  });
  // Anything dropped elsewhere in the window is ignored rather than opened.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // ---------- bubble helpers
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const showBubble = (children, { simple = false, pop = false } = {}) => {
    bubble.replaceChildren(...children);
    bubble.classList.toggle('simple', simple);
    bubble.classList.remove('pop');
    if (pop) { void bubble.offsetWidth; bubble.classList.add('pop'); }
    bubble.classList.add('show');
  };
  const hideBubble = () => bubble.classList.remove('show');

  async function showHint() {
    if (alert || dragging || sayTimer) return;
    let hint;
    try { hint = await api.invoke('pet:hint'); } catch { return; }
    if (!hovering || alert || dragging) return;
    const parts = [el('div', 'label', hint.label), el('div', 'title', hint.title)];
    if (hint.stats) parts.push(el('div', 'stats', hint.stats));
    if (hint.system) parts.push(el('div', 'stats system', hint.system));
    if (hint.hot) parts.push(el('div', 'stats hot', `🔥 I'm burning up! ${hint.reasons.join(', ')}`));
    // Was a native tooltip, which Windows draws under the cursor near the screen
    // edge: it stole the hover and made the buddy flicker endlessly.
    parts.push(el('div', 'stats tip', 'Double-click for tasks · drag to move · right-click for menu'));
    showBubble(parts, { simple: true });
  }
  function hideHint() { if (!alert && !sayTimer) hideBubble(); }

  api.on('pet:say', ({ text, ms = 4000 }) => {
    if (alert) return;
    clearTimeout(sayTimer);
    showBubble([el('div', 'title', text)], { simple: true, pop: true });
    if (options.speech && text) say(text);
    sayTimer = setTimeout(() => { sayTimer = null; if (!alert) hideBubble(); }, ms);
  });

  // ---------- reminders
  api.on('alert', (a) => {
    alert = a;
    clearTimeout(sayTimer);
    sayTimer = null;
    showBubble(renderAlert(a), { pop: true });
    setIgnore(false);
    bubble.querySelector('.btn.primary')?.focus({ preventScroll: true });

    try {
      if (a.chime && options.sound) chime();
      if (a.speak && options.speech) say(a.speak);
    } finally {
      api.send('alert:shown', { deliveryId: a.deliveryId, alertId: a.alertId });
    }
  });

  api.on('alert:clear', () => {
    alert = null;
    hideBubble();
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
    if (!hovering) setIgnore(true);
  });

  api.on('pet:chime', () => { if (options.sound) chime(); });

  const ICONS = { task: '⏰', overdue: '⚠️', break: '💧', summary: '📋' };

  // Header (badge, label, title, dialogue) + actions grouped as:
  // primary button · snooze chips · small text links.
  function renderAlert(a) {
    const kind = a.label === 'Overdue' ? 'overdue' : a.label === 'Break time' ? 'break' : a.label === 'While you were away' ? 'summary' : 'task';
    const badge = el('div', `badge ring ${kind === 'overdue' ? 'overdue' : kind === 'break' ? 'break' : ''}`, ICONS[kind]);
    const text = el('div');
    text.append(el('div', `label${a.priority === 'HIGH' ? ' high' : ''}`, a.label));
    if (a.title) text.append(el('div', 'title', a.title));
    const head = el('div', 'head');
    head.append(badge, text);
    const parts = [head];
    if (a.line) parts.push(el('div', 'line', a.line));

    const actions = el('div', 'actions');
    const primary = a.buttons.find((b) => b.primary);
    if (primary) actions.append(button(primary, 'btn primary'));
    const snoozes = a.buttons.filter((b) => b.action === 'snooze' || b.action === 'custom-snooze');
    if (snoozes.length) {
      const row = el('div', 'snooze');
      row.append(el('span', '', 'Snooze'));
      for (const b of snoozes) row.append(button({ ...b, label: b.action === 'custom-snooze' ? '…' : `${b.minutes}m` }, 'btn chip', b.action === 'custom-snooze' ? 'Custom snooze' : `Snooze ${b.minutes} minutes`));
      actions.append(row);
    }
    const rest = a.buttons.filter((b) => b !== primary && !snoozes.includes(b));
    if (rest.length) {
      const links = el('div', 'links');
      for (const b of rest) links.append(button(b, 'btn link'));
      actions.append(links);
    }
    parts.push(actions);
    return parts;
  }

  function button(b, cls, ariaLabel) {
    const node = el('button', cls, b.label);
    node.type = 'button';
    if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
    node.addEventListener('click', () => {
      if (b.action === 'custom-snooze') return customSnooze();
      api.send('alert:action', { alertId: alert.alertId, action: b.action, minutes: b.minutes });
    });
    return node;
  }

  function customSnooze() {
    const row = el('div', 'snooze');
    const input = el('input');
    Object.assign(input, { type: 'number', min: 1, max: 1440, value: 30 });
    input.setAttribute('aria-label', 'Snooze minutes');
    const ok = el('button', 'btn chip', 'Snooze');
    const go = () => {
      const minutes = Math.round(Number(input.value));
      if (minutes >= 1 && minutes <= 1440) api.send('alert:action', { alertId: alert.alertId, action: 'snooze', minutes });
    };
    ok.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    row.append(el('span', '', 'Snooze'), input, el('span', '', 'min'), ok);
    bubble.querySelector('.snooze').replaceWith(row);
    input.focus();
    input.select();
  }

  // ---------- sound & speech (failures never break the reminder)
  function chime() {
    try {
      window.playChime(options.chimeStyle, options.volume);
    } catch (err) {
      console.warn('chime failed', err);
    }
  }

  function say(text) {
    try {
      const clean = String(text).replace(/[^\p{L}\p{N}\s!?.,'’:-]/gu, '').trim();
      if (!clean) return;
      const u = new SpeechSynthesisUtterance(clean);
      const voice = options.voice && speechSynthesis.getVoices().find((v) => v.name === options.voice);
      if (voice) u.voice = voice;
      u.volume = Math.max(0, Math.min(1, options.volume));
      u.rate = 1.05;
      u.pitch = 1.2;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (err) {
      console.warn('speech failed', err);
    }
  }

  function impactSound() {
    if (!options.sound) return;
    try {
      const ctx = new AudioContext();
      const vol = Math.max(0, Math.min(1, options.volume)) * 0.45;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(130, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.22);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.24);
      setTimeout(() => ctx.close(), 500);
    } catch (e) { /* ignore */ }
  }

  function angrySound() {
    if (!options.sound) return;
    try {
      const ctx = new AudioContext();
      const vol = Math.max(0, Math.min(1, options.volume)) * 0.35;
      [340, 260].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = ctx.currentTime + idx * 0.12;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.linearRampToValueAtTime(vol, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.15);
      });
      setTimeout(() => ctx.close(), 600);
    } catch (e) { /* ignore */ }
  }

  // ---------- state from main
  api.on('pet:state', (s) => {
    if (s.css !== css) stopMannerism();
    css = s.css;
    dir = s.dir;
    if (css !== 'drag') {
      buddy.style.removeProperty('--drag-tilt');
      buddy.classList.remove('fast-drag');
    }
    render();
  });
  api.on('pet:character', setCharacter);
  api.on('pet:options', (o) => { options = { ...options, ...o }; render(); });
  api.on('pet:drag-motion', ({ tilt, fast }) => {
    if (buddy && dragging) {
      buddy.style.setProperty('--drag-tilt', `${tilt.toFixed(1)}deg`);
      buddy.classList.toggle('fast-drag', !!fast);
    }
  });
  api.on('pet:impact-effect', () => {
    const dust = document.getElementById('dust');
    if (!dust) return;
    dust.classList.remove('active');
    void dust.offsetWidth;
    dust.classList.add('active');
  });
  api.on('pet:impact-sound', impactSound);
  api.on('pet:angry-sound', angrySound);

  // ---------- cursor watching, petting, feeding, mood
  api.on('pet:look', (v) => {
    const wasInside = !!look?.inside;
    look = v;
    if (wasInside !== !!v?.inside) render(); else applyLook();
  });
  api.on('pet:mood', (m) => { mood = { level: 'ok', hungry: false, ...m }; render(); });
  api.on('pet:mannerism', (name) => {
    if (!MANNERISMS[name] || mannerism || dragging || alert) return;
    clearTimeout(mannerismTimer);
    mannerism = name;
    render();
    mannerismTimer = setTimeout(() => { mannerism = ''; render(); scheduleMannerism(); }, MANNERISMS[name]);
  });
  let heartsTimer = null;
  api.on('pet:hearts', () => {
    buddy.classList.add('hearts');
    renderSprite();
    clearTimeout(heartsTimer);
    heartsTimer = setTimeout(() => { buddy.classList.remove('hearts'); renderSprite(); }, 1800);
  });
  api.on('pet:purr', () => tones([[110, 0, 0.25, 'sine'], [123, 0.22, 0.3, 'sine'], [988, 0.05, 0.12, 'triangle']], 0.25));
  api.on('pet:eat', () => tones([[300, 0.55, 0.06, 'square'], [260, 0.85, 0.06, 'square'], [300, 1.15, 0.06, 'square'], [660, 1.6, 0.18, 'sine']], 0.12));

  // Short synthesized sound: [frequency, start offset s, length s, wave].
  function tones(list, level) {
    if (!options.sound) return;
    try {
      const ctx = new AudioContext();
      const vol = Math.max(0, Math.min(1, options.volume)) * level;
      for (const [f, at, len, type] of list) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const t0 = ctx.currentTime + at;
        o.type = type;
        o.frequency.setValueAtTime(f, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
        o.connect(g).connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + len + 0.02);
      }
      setTimeout(() => ctx.close(), 2500);
    } catch { /* sound is optional */ }
  }

  // ---------- season & weather
  // Weather is drawn behind the buddy: rain, snow, a drifting cloud, fog or a
  // little sun. Particles are DOM nodes (inline style attributes are blocked by
  // the CSP, CSSOM properties are fine).
  const weatherEl = document.createElement('div');
  weatherEl.id = 'weather';
  weatherEl.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(weatherEl, buddy);
  let weatherKey = '';
  function renderWeather() {
    const w = decor.weather;
    const kind = w ? w.kind : '';
    const key = `${kind}|${w?.day}`;
    if (key === weatherKey) return;
    weatherKey = key;
    weatherEl.className = kind ? `weather w-${kind}${w.day ? '' : ' night'}` : 'weather';
    weatherEl.replaceChildren();
    const add = (cls, n = 1, style) => {
      for (let i = 0; i < n; i++) {
        const d = document.createElement('i');
        d.className = cls;
        if (style) style(d.style, i, n);
        weatherEl.append(d);
      }
    };
    if (kind === 'rain' || kind === 'storm') {
      add('cloud dark');
      add('drop', kind === 'storm' ? 26 : 18, (s, i, n) => {
        s.left = `${(i / n) * 100 + Math.random() * 4}%`;
        s.animationDelay = `${(-Math.random() * 1.2).toFixed(2)}s`;
        s.animationDuration = `${(0.6 + Math.random() * 0.35).toFixed(2)}s`;
      });
      if (kind === 'storm') add('flash');
    } else if (kind === 'snow') {
      add('cloud');
      add('flake', 16, (s, i, n) => {
        s.left = `${(i / n) * 100 + Math.random() * 5}%`;
        s.animationDelay = `${(-Math.random() * 5).toFixed(2)}s`;
        s.animationDuration = `${(3.5 + Math.random() * 2.5).toFixed(2)}s`;
        s.transform = `scale(${(0.6 + Math.random() * 0.7).toFixed(2)})`;
      });
    } else if (kind === 'cloudy') {
      add('cloud drift');
    } else if (kind === 'fog') {
      add('mist', 3, (s, i) => { s.bottom = `${10 + i * 26}px`; s.animationDelay = `${-i * 3}s`; });
    } else if (kind === 'clear' && w.day) {
      add('sun');
    }
  }
  api.on('pet:decor', (d) => {
    const seasonChanged = d.season !== decor.season;
    decor = { season: null, weather: null, ...d };
    if (seasonChanged) setCharacter(charPayload); else render();
    renderWeather();
  });

  // ---------- overheating: smoke from nose, mouth and ears, flames all around
  // The overlay sits beside #buddy (whose SVG is rebuilt on character change)
  // and the puffs are re-anchored to the head while it bobs.
  const heat = document.createElement('div');
  heat.id = 'heat';
  heat.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(heat, buddy.nextSibling);
  // Fire is built from rising teardrop tongues: each one starts as a bright
  // yellow core at the base, swells, turns orange then red and fades as it
  // climbs, so the flames keep licking upward instead of just pulsing.
  const flames = document.createElement('div');
  flames.className = 'flames';
  const glow = document.createElement('b');
  glow.className = 'glow';
  flames.append(glow);
  const TONGUES = 34;
  for (let i = 0; i < TONGUES; i++) {
    const f = document.createElement('i');
    // Spread along the base, taller in the middle, shorter at the edges.
    const x = 6 + Math.random() * 88;
    const edge = 1 - Math.abs(x - 50) / 50;
    f.style.left = `${x.toFixed(1)}%`;
    f.style.setProperty('--rise', `${Math.round(-(45 + edge * 95 + Math.random() * 25))}px`);
    f.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 18)}px`);
    f.style.setProperty('--size', `${Math.round(14 + edge * 14 + Math.random() * 8)}px`);
    const dur = 0.7 + Math.random() * 0.5;
    f.style.animationDuration = `${dur.toFixed(2)}s`;
    f.style.animationDelay = `${(-Math.random() * dur).toFixed(2)}s`;
    flames.append(f);
  }
  const embers = document.createElement('div');
  embers.className = 'embers';
  for (let i = 0; i < 10; i++) {
    const e = document.createElement('i');
    e.style.left = `${10 + Math.random() * 80}%`;
    e.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 50)}px`);
    const dur = 1.4 + Math.random() * 1.2;
    e.style.animationDuration = `${dur.toFixed(2)}s`;
    e.style.animationDelay = `${(-Math.random() * dur).toFixed(2)}s`;
    embers.append(e);
  }
  const puffs = ['nose', 'mouth', 'ear1', 'ear2'].map((spot) => {
    const s = document.createElement('div');
    s.className = `smoke s-${spot}`;
    for (let i = 0; i < 3; i++) {
      const p = document.createElement('i');
      p.style.animationDelay = `${(i * 0.4).toFixed(1)}s`;
      s.append(p);
    }
    return s;
  });
  heat.append(...puffs);
  // Flames go behind the buddy, smoke in front.
  const fire = document.createElement('div');
  fire.id = 'fire';
  fire.setAttribute('aria-hidden', 'true');
  fire.append(flames, embers);
  document.body.insertBefore(fire, buddy);
  let heatTimer = null;
  function placeHeat() {
    const b = buddy.getBoundingClientRect();
    const box = { left: `${b.left - 20}px`, top: `${b.top - 30}px`, width: `${b.width + 40}px`, height: `${b.height + 40}px` };
    Object.assign(heat.style, box);
    Object.assign(fire.style, box);
    const head = buddy.querySelector('#head');
    if (!head) return;
    const h = head.getBoundingClientRect();
    const front = dir < 0 ? h.left : h.right;
    const spots = [
      [front, h.top + h.height * 0.5],
      [front - dir * h.width * 0.12, h.top + h.height * 0.8],
      [h.left + h.width * 0.28, h.top + 2],
      [h.left + h.width * 0.72, h.top + 2],
    ];
    spots.forEach(([x, y], i) => { puffs[i].style.left = `${x - b.left + 20}px`; puffs[i].style.top = `${y - b.top + 30}px`; });
  }
  function renderHeat() {
    const on = hot && !options.paused && options.animation !== 'off';
    heat.classList.toggle('on', on);
    fire.classList.toggle('on', on);
    heat.classList.toggle('left', dir < 0);
    if (on && !heatTimer) { placeHeat(); heatTimer = setInterval(placeHeat, 150); }
    if (!on && heatTimer) { clearInterval(heatTimer); heatTimer = null; }
  }
  api.on('pet:system', (s) => {
    const wasHot = hot;
    hot = !!s?.hot;
    if (hot === wasHot) return;
    render();
    if (hot) angrySound();
  });

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const reportMotion = () => api.send('pet:reduced-motion', motion.matches);
  motion.addEventListener('change', reportMotion);

  setCharacter('dog');
  reportMotion();
  scheduleMannerism();
  api.send('pet:ready');
})();
