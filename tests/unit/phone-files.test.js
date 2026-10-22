import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const { createFileTransfers, safeName } = require('../../electron/phone/files');

const log = { warn() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-files-'));

describe('phone file transfers', () => {
  it('saves a file from the phone, acks it and reports it', () => {
    const dir = tmp();
    const sent = [];
    let received = null;
    const ft = createFileTransfers({ sendLine: (l) => { sent.push(JSON.parse(l)); return true; }, downloadsDir: dir, onReceived: (f) => { received = f; }, log });
    const data = Buffer.from('hello from the phone '.repeat(10000));
    ft.handle({ t: 'fs', id: 'a1', name: '../../evil:photo?.txt', size: data.length });
    for (let i = 0; i < data.length; i += 24576) ft.handle({ t: 'fc', id: 'a1', d: data.subarray(i, i + 24576).toString('base64') });
    ft.handle({ t: 'fe', id: 'a1' });
    expect(received.name).toBe('evil_photo_.txt');
    expect(path.dirname(received.path)).toBe(dir);
    expect(fs.readFileSync(received.path).equals(data)).toBe(true);
    expect(sent.some((m) => m.t === 'fa')).toBe(true);
    expect(sent.at(-1)).toEqual({ t: 'fd', id: 'a1' });
    expect(ft.list()[0]).toMatchObject({ dir: 'in', state: 'done', saved: received.path });
  });

  it("doesn't overwrite an existing file", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'old');
    let received = null;
    const ft = createFileTransfers({ sendLine: () => true, downloadsDir: dir, onReceived: (f) => { received = f; }, log });
    ft.handle({ t: 'fs', id: 'b', name: 'a.txt', size: 3 });
    ft.handle({ t: 'fc', id: 'b', d: Buffer.from('new').toString('base64') });
    ft.handle({ t: 'fe', id: 'b' });
    expect(path.basename(received.path)).toBe('a (1).txt');
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('old');
  });

  it('deletes a partial file when the phone cancels', () => {
    const dir = tmp();
    const ft = createFileTransfers({ sendLine: () => true, downloadsDir: dir, log });
    ft.handle({ t: 'fs', id: 'c', name: 'big.bin', size: 100 });
    ft.handle({ t: 'fc', id: 'c', d: Buffer.alloc(10).toString('base64') });
    ft.handle({ t: 'fx', id: 'c', reason: 'Cancelled on the phone' });
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(ft.list()[0]).toMatchObject({ state: 'failed', error: 'Cancelled on the phone' });
  });

  it('sends a file to the phone in chunks, waiting for acks', async () => {
    const dir = tmp();
    const file = path.join(dir, 'doc.pdf');
    const data = Buffer.alloc(1_000_000, 7);
    fs.writeFileSync(file, data);
    let ft;
    const got = [];
    // A fake phone: collects chunks and acks like FileLink.java does.
    const phone = (m) => {
      if (m.t === 'fc') {
        got.push(Buffer.from(m.d, 'base64'));
        const n = got.reduce((a, b) => a + b.length, 0);
        setImmediate(() => ft.handle({ t: 'fa', id: m.id, n }));
      }
      if (m.t === 'fe') setImmediate(() => ft.handle({ t: 'fd', id: m.id }));
    };
    ft = createFileTransfers({ sendLine: (l) => { phone(JSON.parse(l)); return true; }, downloadsDir: dir, log });
    await ft.sendFiles([file]);
    expect(Buffer.concat(got).equals(data)).toBe(true);
    expect(ft.list()[0]).toMatchObject({ dir: 'out', name: 'doc.pdf', state: 'done', size: 1_000_000 });
  });

  it('stops sending when cancelled', async () => {
    const dir = tmp();
    const file = path.join(dir, 'v.mp4');
    fs.writeFileSync(file, Buffer.alloc(2_000_000));
    const sent = [];
    const ft = createFileTransfers({ sendLine: (l) => { sent.push(JSON.parse(l)); return true; }, downloadsDir: dir, log });
    const done = ft.sendFiles([file]);
    await new Promise((r) => setTimeout(r, 50)); // window fills, no acks come
    ft.cancel(ft.list()[0].id);
    await done;
    expect(ft.list()[0].state).toBe('cancelled');
    expect(sent.filter((m) => m.t === 'fc').length).toBeLessThanOrEqual(17);
    expect(sent.at(-1)).toMatchObject({ t: 'fx' });
  });

  it('makes phone names safe for Windows', () => {
    expect(safeName('con.txt')).toBe('_con.txt');
    expect(safeName(String.raw`a/b\c.jpg`)).toBe('c.jpg');
    expect(safeName('...')).toBe('file');
  });
});
