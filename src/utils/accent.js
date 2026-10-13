// Accent palettes for the task manager. Applying one overrides the Tailwind
// --color-brand-* variables, so every brand-* utility follows it.
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

export const ACCENTS = {
  amber: { name: 'Amber', scale: ['#fff7ed', '#ffedd5', '#fdd8b0', '#f8bb7c', '#f0a35d', '#e8994a', '#cf7a2c', '#a75d1f', '#7c4519', '#4e2c12'] },
  rose: { name: 'Rose', scale: ['#fff1f2', '#ffe4e6', '#fecdd3', '#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c', '#9f1239', '#881337'] },
  violet: { name: 'Violet', scale: ['#f5f3ff', '#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95'] },
  sky: { name: 'Sky', scale: ['#f0f9ff', '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e'] },
  emerald: { name: 'Emerald', scale: ['#ecfdf5', '#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b'] },
};

// "Match my buddy": each character gets the accent that suits its colours.
const CHARACTER_ACCENT = { dog: 'amber', tom: 'sky', cat: 'violet', hero: 'rose', ranger: 'emerald' };

export function resolveAccent(accent, character) {
  if (accent && accent !== 'character' && ACCENTS[accent]) return accent;
  return CHARACTER_ACCENT[character] || 'amber';
}

export function applyAccent(id, root = document.documentElement) {
  const { scale } = ACCENTS[id] || ACCENTS.amber;
  STEPS.forEach((step, i) => root.style.setProperty(`--color-brand-${step}`, scale[i]));
}
