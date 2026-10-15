// Landing page: the real buddy (same art and CSS as the app) acts out a
// reminder on a pretend taskbar, and the download buttons point straight at
// the newest installer on GitHub Releases.
(() => {
  const REPO = 'Abhijith1001/Desktop_companion';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const buddy = document.getElementById('buddy');
  const walker = document.getElementById('walker');
  const bubble = document.getElementById('bubble');
  const screen = walker.parentElement;
  let character = 'dog';
  let state = 'idle';
  let dir = 1;
  let x = 30;

  document.getElementById('year').textContent = new Date().getFullYear();

  // ---------- drawing
  function draw() {
    const c = window.CHARACTERS?.[character];
    buddy.className = ['buddy', state, dir < 0 ? 'left' : '', c?.upright ? 'upright' : '', reduceMotion ? 'reduced' : ''].filter(Boolean).join(' ');
  }
  function setCharacter(id) {
    character = id;
    buddy.innerHTML = window.buddyMarkup(id, null); // static SVG from characters.js
    draw();
    for (const b of document.querySelectorAll('#picker button')) b.setAttribute('aria-checked', String(b.dataset.id === id));
  }

  // ---------- character picker
  if (window.CHARACTERS) {
    const picker = document.getElementById('picker');
    for (const [id, c] of Object.entries(window.CHARACTERS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.name);
      b.title = c.name;
      const preview = document.createElement('div');
      preview.className = `buddy idle${c.upright ? ' upright' : ''}`;
      preview.innerHTML = window.buddyMarkup(id, null);
      b.append(preview);
      b.addEventListener('click', () => setCharacter(id));
      picker.append(b);
    }
    setCharacter('dog');
  }

  // ---------- choreography
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const maxX = () => screen.clientWidth - walker.offsetWidth * 0.85;
  function moveTo(target, speed) {
    return new Promise((resolve) => {
      dir = target >= x ? 1 : -1;
      draw();
      let last = performance.now();
      const step = (now) => {
        const dt = Math.min(50, now - last);
        last = now;
        x += dir * speed * dt;
        if ((dir > 0 && x >= target) || (dir < 0 && x <= target)) { x = target; walker.style.translate = `${x}px 0`; resolve(); return; }
        walker.style.translate = `${x}px 0`;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  let doneClicked = null;
  document.getElementById('done-btn').addEventListener('click', () => doneClicked?.());

  async function loop() {
    walker.style.translate = `${x}px 0`;
    if (reduceMotion || !window.CHARACTERS) { bubble.classList.add('show'); return; }
    for (;;) {
      state = 'walk'; await moveTo(maxX() * 0.75, 0.06);
      state = 'idle'; draw(); await sleep(1400);
      state = 'sit'; draw(); await sleep(1800);
      // Something is due: run to the centre and ask.
      document.getElementById('clock').textContent = '9:30';
      state = 'run'; await moveTo(maxX() / 2, 0.22);
      state = 'alert'; draw();
      bubble.classList.add('show');
      await Promise.race([sleep(4200), new Promise((r) => { doneClicked = r; })]);
      doneClicked = null;
      bubble.classList.remove('show');
      state = 'happy'; draw(); await sleep(1300);
      state = 'walk'; await moveTo(20, 0.06);
      state = 'idle'; draw(); await sleep(1600);
    }
  }
  loop();

  // ---------- download buttons → newest installer
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    .then((r) => (r.ok ? r.json() : null))
    .then((rel) => {
      const exe = rel?.assets?.find((a) => a.name.endsWith('.exe'));
      if (!exe) return;
      for (const id of ['download-btn-0', 'download-btn', 'download-btn-2']) document.getElementById(id).href = exe.browser_download_url;
      const mb = Math.round(exe.size / 1_048_576);
      document.getElementById('download-note').textContent = `Version ${rel.tag_name.replace(/^v/, '')} · ${mb} MB · free · works offline`;
    })
    .catch(() => { /* the links already point at the releases page */ });
})();
