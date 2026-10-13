// Unlockable scene backgrounds (unlock rules live in electron/services/progress.js).
// `stops` are shared by the CSS gradient and the recap image canvas.
export const BACKGROUNDS = {
  meadow: { stops: ['#e0f2fe', '#fff7ed', '#dcfce7'], ink: '#1c1917' },
  sunset: { stops: ['#fde68a', '#fb923c', '#f472b6'], ink: '#1c1917' },
  night: { stops: ['#1e1b4b', '#312e81', '#4c1d95'], ink: '#f5f5f4' },
  ocean: { stops: ['#a5f3fc', '#38bdf8', '#1d4ed8'], ink: '#0c0a09' },
  space: { stops: ['#020617', '#1e1b4b', '#581c87'], ink: '#f5f5f4' },
};

export const bg = (id) => BACKGROUNDS[id] || BACKGROUNDS.meadow;
export const bgCss = (id) => `linear-gradient(160deg, ${bg(id).stops.join(', ')})`;
