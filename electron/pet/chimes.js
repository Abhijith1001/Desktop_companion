// Reminder chime styles, synthesized with Web Audio (no sound files). Loaded as
// a plain script by the pet window and imported by the task manager so the
// Settings page can preview the same sounds.
// Each note: [frequency Hz, start offset s, length s, wave].
(() => {
  const CHIMES = {
    bells: { name: 'Bells', level: 0.4, notes: [[880, 0, 0.3, 'sine'], [1175, 0.14, 0.3, 'sine'], [1568, 0.28, 0.3, 'sine']] },
    marimba: { name: 'Marimba', level: 0.45, notes: [[523, 0, 0.22, 'triangle'], [659, 0.12, 0.22, 'triangle'], [784, 0.24, 0.22, 'triangle'], [1047, 0.36, 0.35, 'triangle']] },
    soft: { name: 'Soft hum', level: 0.35, notes: [[392, 0, 0.7, 'sine'], [494, 0.18, 0.7, 'sine'], [587, 0.36, 0.9, 'sine']] },
    arcade: { name: 'Arcade', level: 0.12, notes: [[660, 0, 0.08, 'square'], [880, 0.08, 0.08, 'square'], [1320, 0.16, 0.16, 'square']] },
    droplet: { name: 'Droplet', level: 0.4, notes: [[1400, 0, 0.12, 'sine'], [1900, 0.1, 0.12, 'sine'], [1600, 0.32, 0.18, 'sine']] },
  };

  function playChime(style, volume = 0.6) {
    const c = CHIMES[style] || CHIMES.bells;
    const ctx = new AudioContext();
    const vol = Math.max(0, Math.min(1, volume)) * c.level;
    let end = 0;
    for (const [f, at, len, type] of c.notes) {
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
      end = Math.max(end, at + len);
    }
    setTimeout(() => ctx.close(), (end + 0.5) * 1000);
  }

  window.CHIMES = CHIMES;
  window.playChime = playChime;
})();
