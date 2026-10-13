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

  // ---------- drawing
  function render() {
    const c = window.CHARACTERS[character] || window.CHARACTERS.dog;
    buddy.className = ['buddy', css, dir < 0 ? 'left' : '', c.upright ? 'upright' : '',
      options.animation === 'reduced' ? 'reduced' : '', options.animation === 'off' ? 'still' : '',
      options.paused ? 'paused' : '', mannerism ? `m-${mannerism}` : ''].filter(Boolean).join(' ');
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
  function setCharacter(id) {
    character = window.CHARACTERS[id] ? id : 'dog';
    buddy.innerHTML = window.buddyMarkup(character);
    render();
  }

  // ---------- click-through: only the buddy and bubble catch the mouse
  const setIgnore = (v) => api.send('pet:set-ignore', v);
  for (const el of [buddy, bubble]) {
    el.addEventListener('mouseenter', () => {
      hovering = true;
      setIgnore(false);
      if (el === buddy) showHint();
    });
    el.addEventListener('mouseleave', () => {
      hovering = false;
      if (!dragging) setIgnore(true);
      if (el === buddy) hideHint();
    });
  }

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
    showBubble([el('div', 'label', hint.label), el('div', 'title', hint.title)], { simple: true });
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
      const ctx = new AudioContext();
      const vol = Math.max(0, Math.min(1, options.volume)) * 0.4;
      [880, 1175, 1568].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        const t0 = ctx.currentTime + i * 0.14;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        o.connect(g).connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + 0.32);
      });
      setTimeout(() => ctx.close(), 1000);
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

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const reportMotion = () => api.send('pet:reduced-motion', motion.matches);
  motion.addEventListener('change', reportMotion);

  setCharacter('dog');
  reportMotion();
  scheduleMannerism();
  api.send('pet:ready');
})();
