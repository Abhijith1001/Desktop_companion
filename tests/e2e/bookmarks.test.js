// Drives the real Electron app: drag-and-drop into the chat, saving a
// bookmark from the preview card, a real capture through the Windows helper
// (clipboard must come back unchanged), shortcut settings and persistence.
// Run with: npm run test:e2e
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { _electron as electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-e2e-bm-'));

async function waitForWindow(app, fragment, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const w = app.windows().find((p) => p.url().includes(fragment));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`window ${fragment} did not open`);
}

async function launch() {
  const env = { ...process.env, BUDDY_USER_DATA: dataDir, BUDDY_MUTE: '1', BUDDY_SKIP_ONBOARDING: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: root, env });
  const pet = await waitForWindow(app, 'pet.html');
  await pet.waitForFunction(() => window.buddyMarkup && document.querySelector('#buddy svg'));
  await pet.evaluate(async () => { // double-click opens the task manager
    const b = document.getElementById('buddy');
    for (let i = 0; i < 2; i++) {
      b.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
    }
  });
  const manager = await waitForWindow(app, 'index.html');
  await manager.waitForFunction(() => !!window.buddy);
  return { app, manager };
}

// Simulates a text drag from another app onto the chat.
async function dropText(page, text, extra = {}) {
  await page.evaluate(({ text, extra }) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    for (const [k, v] of Object.entries(extra)) dt.setData(k, v);
    const target = document.querySelector('#chat-input').closest('.relative');
    target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.__overlay = document.body.textContent.includes('Drop text to capture it');
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { text, extra });
}

describe('bookmarks & capture (e2e)', () => {
  let session;

  beforeAll(() => {
    if (!fs.existsSync(path.join(root, 'dist/index.html'))) throw new Error('Run `npm run build` before the e2e tests');
  });

  afterAll(async () => {
    await session?.app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('drops text into the chat, previews it and saves a bookmark', async () => {
    session = await launch();
    const { manager } = session;
    await manager.evaluate(() => { window.location.hash = '/chat'; });
    await manager.locator('#chat-input').waitFor();

    await dropText(manager, 'Photosynthesis converts light energy into chemical energy.', { 'text/uri-list': 'https://en.wikipedia.org/wiki/Photosynthesis' });
    const card = manager.locator('article[aria-label="Captured text preview"]');
    await card.waitFor({ timeout: 15_000 });
    expect(await card.textContent()).toContain('Photosynthesis converts light energy');
    expect(await card.textContent()).toContain('https://en.wikipedia.org/wiki/Photosynthesis');

    await card.getByRole('button', { name: /Add note/ }).click();
    await card.getByLabel('Note').fill('Biology revision');
    await card.getByLabel('Tags').fill('Science, exam');
    await card.getByRole('button', { name: /Save bookmark/ }).click();
    await card.getByText(/Saved as/).waitFor();

    const list = await manager.evaluate(() => window.buddy.bookmarks.list({ q: 'photosynthesis' }));
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ notes: 'Biology revision', tags: ['exam', 'science'], captureMethod: 'drop', sourceUrl: 'https://en.wikipedia.org/wiki/Photosynthesis' });
  }, 90_000);

  it('warns about sensitive text and does not save duplicates silently', async () => {
    const { manager } = session;
    await dropText(manager, 'password: hunter2');
    const card = manager.locator('article[aria-label="Captured text preview"]').last();
    await card.getByRole('alert').filter({ hasText: 'password' }).waitFor({ timeout: 15_000 });
    await card.getByRole('button', { name: /^Cancel$/ }).click();
    await manager.getByText('Capture discarded.').waitFor();

    await dropText(manager, 'Photosynthesis converts light energy into chemical energy.', { 'text/uri-list': 'https://en.wikipedia.org/wiki/Photosynthesis' });
    const dup = manager.locator('article[aria-label="Captured text preview"]').last();
    await dup.getByRole('button', { name: /Save bookmark/ }).click();
    await dup.getByText(/already saved this text/).waitFor();
    expect((await manager.evaluate(() => window.buddy.bookmarks.list())).total).toBe(1);
  }, 60_000);

  it('runs a real capture through the Windows helper and leaves the clipboard as it was', async () => {
    const { app, manager } = session;
    await app.evaluate(({ clipboard, ClipboardItem }) => clipboard.write([new ClipboardItem({ 'text/plain': 'USER CLIPBOARD', 'text/html': '<i>USER CLIPBOARD</i>' })]));
    const r = await manager.evaluate(() => window.buddy.capture.selection(0));
    // Whatever window is active, the call must resolve with a result, not crash.
    expect(typeof r.ok).toBe('boolean');
    if (!r.ok) expect(r.message).toBeTruthy();
    const clip = await app.evaluate(async ({ clipboard }) => {
      const [item] = await clipboard.read();
      return { text: await clipboard.readText(), html: await (await item.getType('text/html')).text() };
    });
    expect(clip.text).toBe('USER CLIPBOARD');
    expect(clip.html).toContain('USER CLIPBOARD');
    console.log('real capture result:', JSON.stringify({ ok: r.ok, reason: r.reason, method: r.method, app: r.sourceApp }));
  }, 60_000);

  it('registers the global shortcuts and re-registers after a change', async () => {
    const { manager } = session;
    const before = await manager.evaluate(() => window.buddy.capture.status());
    expect(before.shortcuts.capture.accelerator).toBe('Control+Shift+B');
    await manager.evaluate(() => window.buddy.settings.update({ capture: { shortcut: 'Control+Alt+K', ocrEnabled: true } }));
    const after = await manager.evaluate(() => window.buddy.capture.status());
    expect(after.shortcuts.capture).toMatchObject({ accelerator: 'Control+Alt+K', registered: true });
    expect(after.shortcuts.ocr).toMatchObject({ accelerator: 'Control+Shift+O' });
    const bad = await manager.evaluate(() => window.buddy.settings.update({ capture: { shortcut: 'Control+C' } }).then(() => null, (e) => e.message));
    expect(bad).toMatch(/reserved/);
  }, 30_000);

  it('notepad autosaves what you type', async () => {
    const { manager } = session;
    await manager.evaluate(() => { window.location.hash = '/notepad'; });
    await manager.getByRole('button', { name: '+ New', exact: true }).click();
    await manager.getByLabel('Note title').fill('Shopping');
    await manager.getByLabel('Note text').fill('apples\npears');
    await manager.getByText('✓ Saved').waitFor({ timeout: 10_000 });
    const notes = await manager.evaluate(() => window.buddy.notes.list());
    expect(notes[0]).toMatchObject({ title: 'Shopping', body: 'apples\npears' });
  }, 30_000);

  it('calculator works with buttons and the keyboard', async () => {
    const { manager } = session;
    await manager.evaluate(() => { window.location.hash = '/calculator'; });
    const calc = manager.getByLabel(/^Calculator\./);
    for (const k of ['7', 'Multiply', '6']) await manager.getByRole('button', { name: k, exact: true }).click();
    await manager.getByRole('button', { name: '=', exact: true }).click();
    await expect.poll(() => calc.textContent()).toContain('42');
    await calc.focus();
    await manager.keyboard.type('+8');
    await manager.keyboard.press('Enter');
    await expect.poll(() => calc.textContent()).toContain('50');
    await manager.keyboard.type('/0');
    await manager.keyboard.press('Enter');
    await expect.poll(() => calc.textContent()).toContain('Cannot divide by zero');
  }, 30_000);

  it('keeps bookmarks after a restart', async () => {
    await session.app.close();
    session = await launch();
    const list = await session.manager.evaluate(() => window.buddy.bookmarks.list());
    expect(list.items.map((b) => b.notes)).toContain('Biology revision');
    expect((await session.manager.evaluate(() => window.buddy.notes.list())).map((n) => n.title)).toContain('Shopping');
    await session.manager.evaluate(() => { window.location.hash = '/bookmarks'; });
    await session.manager.getByText('Photosynthesis converts light energy').first().waitFor();
  }, 90_000);
});
