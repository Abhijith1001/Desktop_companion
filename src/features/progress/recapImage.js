// Renders the weekly recap as a 1080×1080 PNG for sharing.
import { bg } from './backgrounds';

const SIZE = 1080;

// The buddy as a standalone image. buddy.css isn't available inside an <img>,
// so the alternate-state parts it normally hides are hidden inline here.
function buddyImage(character, accessory) {
  const svg = window.buddyMarkup(character, accessory)
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="520" ')
    .replace('>', '><style>#eye-closed,.zzz,.fx,#tongue{display:none}</style>');
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

export async function renderRecap({ recap, progress, character, accessory, background, buddyName }) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const { stops, ink } = bg(background);
  const font = (w, px) => `${w} ${px}px "Segoe UI", system-ui, sans-serif`;

  const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.font = font(600, 34);
  ctx.globalAlpha = 0.75;
  ctx.fillText('MY WEEK WITH DESKTOP BUDDY', SIZE / 2, 90);
  ctx.globalAlpha = 1;

  const name = buddyName || window.CHARACTERS[character]?.name || 'Buddy';
  ctx.font = font(800, 72);
  ctx.fillText(recap.total === 1 ? 'You finished 1 task!' : `You finished ${recap.total} tasks!`, SIZE / 2, 185);
  ctx.font = font(500, 40);
  ctx.fillText(recap.total ? `${name} is proud of you 💛` : `${name} believes in you 💛`, SIZE / 2, 245);

  try {
    ctx.drawImage(await buddyImage(character, accessory), (SIZE - 560) / 2, 255, 560, 455);
  } catch { /* the card still works without the picture */ }

  // Stat pills
  const stats = [
    [`🔥 ${progress.streak}`, 'day streak'],
    [`⭐ ${progress.level}`, progress.stage],
    [`🏆 ${recap.newBadges.length}`, recap.newBadges.length === 1 ? 'new badge' : 'new badges'],
  ];
  stats.forEach(([big, small], i) => {
    const w = 290;
    const x = 60 + i * (w + 25);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    roundRect(ctx, x, 720, w, 130, 28);
    ctx.fillStyle = '#1c1917';
    ctx.font = font(800, 48);
    ctx.fillText(big, x + w / 2, 785);
    ctx.font = font(500, 28);
    ctx.fillText(small, x + w / 2, 825);
  });

  // Daily bars
  const max = Math.max(1, ...recap.days.map((d) => d.count));
  recap.days.forEach((d, i) => {
    const slot = (SIZE - 160) / 7;
    const x = 80 + i * slot + slot / 2;
    const h = (d.count / max) * 110;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    roundRect(ctx, x - 28, 880, 56, 110, 12);
    ctx.fillStyle = '#e8994a';
    if (h) roundRect(ctx, x - 28, 990 - h, 56, h, 12);
    ctx.fillStyle = ink;
    ctx.font = font(600, 26);
    ctx.fillText(d.label, x, 1030);
  });

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
