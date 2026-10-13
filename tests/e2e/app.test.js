// Drives the real Electron app with Playwright, using a throwaway data folder.
// Run with: npm run test:e2e   (requires `npm run build` first)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { _electron as electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-e2e-'));

async function launch() {
  const env = { ...process.env, BUDDY_USER_DATA: dataDir, BUDDY_MUTE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: root, env });
  const pet = await waitForWindow(app, 'pet.html');
  return { app, pet };
}

async function waitForWindow(app, fragment, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const w = app.windows().find((p) => p.url().includes(fragment));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`window ${fragment} did not open`);
}

// Clicking the buddy (press + release without moving) opens the task manager.
async function openManager(app, pet) {
  await pet.waitForFunction(() => window.buddyMarkup && document.querySelector('#buddy svg'));
  await pet.evaluate(() => {
    const b = document.getElementById('buddy');
    b.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
  });
  const manager = await waitForWindow(app, 'index.html');
  await manager.waitForFunction(() => !!window.buddy);
  return manager;
}

const bubbleText = (pet) => pet.evaluate(() => (document.querySelector('#bubble.show') || {}).textContent || '');

async function waitForBubble(pet, text, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if ((await bubbleText(pet)).includes(text)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`bubble with "${text}" never appeared (last: "${await bubbleText(pet)}")`);
}

describe('desktop app (e2e)', () => {
  let session;

  beforeAll(() => {
    if (!fs.existsSync(path.join(root, 'dist/index.html'))) throw new Error('Run `npm run build` before the e2e tests');
  });

  afterAll(async () => {
    await session?.app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('delivers a recurring reminder via the buddy and advances it when done', async () => {
    session = await launch();
    const manager = await openManager(session.app, session.pet);
    await expect(manager.locator('h1')).toBeTruthy();

    const task = await manager.evaluate(() => window.buddy.tasks.create({
      title: 'E2E daily standup', timeZone: 'UTC', recurrence: { type: 'daily' },
      dueAt: new Date(Date.now() + 3000).toISOString(),
    }));

    await waitForBubble(session.pet, 'E2E daily standup');
    await session.pet.locator('#bubble button', { hasText: 'Mark done' }).click();

    await expect.poll(async () => (await manager.evaluate((id) => window.buddy.tasks.get(id), task.id)).history[0]?.status, { timeout: 10_000 })
      .toBe('PENDING');
    const after = await manager.evaluate((id) => window.buddy.tasks.get(id), task.id);
    expect(after.status).toBe('PENDING');
    expect(Date.parse(after.nextOccurrenceAt)).toBe(Date.parse(task.nextOccurrenceAt) + 86_400_000);
    expect(after.history.find((h) => h.scheduledAt === task.nextOccurrenceAt).status).toBe('COMPLETED');
  }, 90_000);

  it('rejects invalid input over IPC', async () => {
    const manager = await waitForWindow(session.app, 'index.html');
    const err = await manager.evaluate(() => window.buddy.tasks.create({ title: '', timeZone: 'UTC' }).then(() => null, (e) => e.message));
    expect(err).toMatch(/title/i);
  }, 30_000);

  it('keeps tasks and delivers a reminder that came due while the app was closed', async () => {
    const manager = await waitForWindow(session.app, 'index.html');
    await manager.evaluate(() => window.buddy.tasks.create({
      title: 'E2E while closed', timeZone: 'UTC', dueAt: new Date(Date.now() + 4000).toISOString(),
    }));
    await session.app.close();
    await new Promise((r) => setTimeout(r, 6000)); // it comes due while closed

    session = await launch();
    await waitForBubble(session.pet, 'E2E while closed');
    const manager2 = await openManager(session.app, session.pet).catch(() => waitForWindow(session.app, 'index.html'));
    const titles = (await manager2.evaluate(() => window.buddy.tasks.list())).map((t) => t.title);
    expect(titles).toEqual(expect.arrayContaining(['E2E daily standup', 'E2E while closed']));
  }, 90_000);
});
