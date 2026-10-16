import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { avcCodecString } from '../../src/features/phone/avc.js';
import { mapKey } from '../../src/features/phone/keys.js';
const require = createRequire(import.meta.url);
const p = require('../../electron/phone/protocol');
const { parseDevices, parseMdns } = require('../../electron/phone');
const { createHandlers } = require('../../electron/ipc/handlers');

function header({ config = false, key = false, pts = 0, size }) {
  const h = Buffer.alloc(12);
  let v = BigInt(pts);
  if (config) v |= 1n << 63n;
  if (key) v |= 1n << 62n;
  h.writeBigUInt64BE(v, 0);
  h.writeUInt32BE(size, 8);
  return h;
}

function streamStart(name = 'Pixel 8', w = 1080, h = 2400) {
  const dev = Buffer.alloc(64);
  dev.write(name);
  const meta = Buffer.alloc(12);
  meta.writeUInt32BE(0x68323634, 0);
  meta.writeUInt32BE(w, 4);
  meta.writeUInt32BE(h, 8);
  return Buffer.concat([dev, meta]);
}

describe('video parser', () => {
  it('reads device, codec and frames, merging config into the next packet', () => {
    const events = [];
    const push = p.createVideoParser((e) => events.push(e));
    const sps = Buffer.from([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1f]);
    const frame = Buffer.from([0, 0, 0, 1, 0x65, 1, 2, 3]);
    const all = Buffer.concat([
      streamStart(), header({ config: true, size: sps.length }), sps,
      header({ key: true, pts: 1000, size: frame.length }), frame,
      header({ pts: 2000, size: 2 }), Buffer.from([9, 9]),
    ]);
    // Byte-at-a-time: the parser must cope with any chunking.
    for (const b of all) push(Buffer.from([b]));
    expect(events[0]).toEqual({ type: 'device', name: 'Pixel 8' });
    expect(events[1]).toEqual({ type: 'codec', codec: 'h264', width: 1080, height: 2400 });
    expect(events[2]).toMatchObject({ type: 'frame', key: true, pts: 1000 });
    expect(Buffer.compare(events[2].data, Buffer.concat([sps, frame]))).toBe(0);
    expect(events[3]).toMatchObject({ type: 'frame', key: false, pts: 2000 });
    expect(events).toHaveLength(4);
  });

  it('rejects other codecs and absurd packet sizes', () => {
    const bad = streamStart();
    bad.writeUInt32BE(0x68323635, 64);
    expect(() => p.createVideoParser(() => {})(bad)).toThrow(/codec/);
    expect(() => p.createVideoParser(() => {})(Buffer.concat([streamStart(), header({ size: 0 })]))).toThrow(/size/);
  });
});

describe('device messages', () => {
  it('parses clipboard messages split across chunks and skips acks', () => {
    const got = [];
    const push = p.createDeviceMessageParser((m) => got.push(m));
    const text = Buffer.from('héllo');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(text.length);
    push(Buffer.concat([Buffer.from([1]), Buffer.alloc(8), Buffer.from([0]), len.subarray(0, 2)]));
    push(Buffer.concat([len.subarray(2), text]));
    expect(got).toEqual([{ type: 'clipboard', text: 'héllo' }]);
  });
});

describe('control messages', () => {
  it('encodes a touch as 32 bytes with the finger pointer', () => {
    const b = p.touch({ action: p.ACTION.DOWN, x: 100, y: 200, width: 1080, height: 2400 });
    expect(b).toHaveLength(32);
    expect(b[0]).toBe(2);
    expect(b[1]).toBe(0);
    expect(b.readBigInt64BE(2)).toBe(-2n);
    expect(b.readInt32BE(10)).toBe(100);
    expect(b.readInt32BE(14)).toBe(200);
    expect(b.readUInt16BE(18)).toBe(1080);
    expect(b.readUInt16BE(20)).toBe(2400);
    expect(b.readUInt16BE(22)).toBe(0xffff);
    expect(p.touch({ action: p.ACTION.UP, x: 0, y: 0, width: 1, height: 1 }).readUInt16BE(22)).toBe(0);
  });

  it('encodes scroll as 21 bytes with clamped fixed-point amounts', () => {
    const b = p.scroll({ x: 1, y: 2, width: 10, height: 20, vscroll: -100, hscroll: 8 });
    expect(b).toHaveLength(21);
    expect(b[0]).toBe(3);
    expect(b.readInt16BE(13)).toBe(0x4000);
    expect(b.readInt16BE(15)).toBe(-0x8000);
  });

  it('encodes key codes, text and clipboard paste', () => {
    const k = p.keycode({ action: p.ACTION.UP, keycode: 66, metastate: 1 });
    expect([...k]).toEqual([0, 1, 0, 0, 0, 66, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect([...p.text('hi')]).toEqual([1, 0, 0, 0, 2, 104, 105]);
    const c = p.setClipboard('ok', { paste: true });
    expect(c[0]).toBe(9);
    expect(c[9]).toBe(1);
    expect(c.readUInt32BE(10)).toBe(2);
    expect(p.keyPress(3)).toHaveLength(28);
  });

  it('truncates text without splitting a UTF-8 character', () => {
    const b = p.text(`${'a'.repeat(299)}€`);
    expect(b.readUInt32BE(1)).toBe(299);
    expect(p.truncateUtf8('€€', 4).toString()).toBe('€');
  });
});

describe('adb output parsing', () => {
  it('lists wifi and usb devices', () => {
    const out = 'List of devices attached\n192.168.1.20:41023 device product:husky model:Pixel_8_Pro device:husky transport_id:2\nR58M123 unauthorized usb:1-1 transport_id:1\n\n';
    expect(parseDevices(out)).toEqual([
      { serial: '192.168.1.20:41023', state: 'device', model: 'Pixel 8 Pro', wifi: true },
      { serial: 'R58M123', state: 'unauthorized', model: 'R58M123', wifi: false },
    ]);
  });

  it('finds phones advertising wireless debugging', () => {
    const out = 'List of discovered mdns services\nadb-R58M-abc\t_adb-tls-connect._tcp\t192.168.1.20:41023\nadb-R58M-abc\t_adb-tls-pairing._tcp.\t192.168.1.20:37155\n';
    expect(parseMdns(out)).toEqual([
      { name: 'adb-R58M-abc', kind: 'connect', host: '192.168.1.20', port: 41023 },
      { name: 'adb-R58M-abc', kind: 'pairing', host: '192.168.1.20', port: 37155 },
    ]);
  });
});

describe('renderer helpers', () => {
  it('builds the WebCodecs codec string from the SPS', () => {
    expect(avcCodecString(new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28, 0xac]))).toBe('avc1.640028');
    expect(avcCodecString(new Uint8Array([0, 0, 0, 1, 0x65, 1, 2, 3]))).toBeNull();
  });

  it('maps desktop keys to phone input', () => {
    const k = (key, mods = {}) => mapKey({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
    expect(k('a')).toEqual({ text: 'a' });
    expect(k('😀')).toEqual({ text: '😀' });
    expect(k('Enter')).toEqual({ keycode: 66, metastate: 0 });
    expect(k('v', { ctrlKey: true })).toEqual({ paste: true });
    expect(k('a', { ctrlKey: true })).toEqual({ keycode: 29, metastate: 0x1000 });
    expect(k('Escape')).toEqual({ button: 'back' });
    expect(k('€', { ctrlKey: true, altKey: true })).toEqual({ text: '€' });
    expect(k('F5')).toBeNull();
  });
});

describe('phone notifications', () => {
  const { parseNotifications, createTracker, cleanTitle, createNotificationWatcher } = require('../../electron/phone/notifications');
  const record = ({ pkg, id, title, when, flags = 'AUTO_CANCEL' }) => [
    `    NotificationRecord(0x0${id}: pkg=${pkg} user=UserHandle{0} id=${id} tag=null importance=4 key=0|${pkg}|${id}|null|10345: Notification(channel=x))`,
    `      flags=${flags}`, `      key=0|${pkg}|${id}|null|10345`, '      notification=',
    `            when=${when}/${when}`, '            extras={',
    `                android.title=String (${title})`, '                android.text=String (secret message body)',
    '            }',
  ].join('\n');
  const dump = (...records) => `Current Notification Manager state:\n  Notification List:\n${records.join('\n')}\n  mMaxPackageEnqueueRate=5.0\n  Snoozed notifications:\n`;

  it('reads app, title, text and time for the panel', () => {
    const list = parseNotifications(dump(record({ pkg: 'com.whatsapp', id: 1, title: 'Rahul', when: 100 })));
    expect(list).toEqual([{
      key: '0|com.whatsapp|1|null', pkg: 'com.whatsapp', title: 'Rahul', text: 'secret message body', subText: null,
      when: 100, summary: false, ongoing: false,
    }]);
  });

  it('lists real notifications newest first, without summaries or ongoing ones', () => {
    const { visibleList } = require('../../electron/phone/notifications');
    const list = visibleList(parseNotifications(dump(
      record({ pkg: 'com.whatsapp', id: 1, title: 'Rahul', when: 100 }),
      record({ pkg: 'com.flipkart.android', id: 2, title: 'Sale', when: 300 }),
      record({ pkg: 'com.spotify.music', id: 3, title: 'Playing', when: 400, flags: 'ONGOING_EVENT|FOREGROUND_SERVICE' }),
      record({ pkg: 'com.whatsapp', id: 9, title: 'WhatsApp', when: 500, flags: 'GROUP_SUMMARY' }),
      record({ pkg: 'android', id: 62, title: 'USB debugging connected', when: 600 }),
    )));
    expect(list.map((n) => [n.app, n.title])).toEqual([['Flipkart', 'Sale'], ['WhatsApp', 'Rahul']]);
    expect(list[1].text).toBe('secret message body');
  });

  it('announces only messages that arrive after the first look', () => {
    const t = createTracker();
    const old = record({ pkg: 'com.whatsapp', id: 1, title: 'Rahul', when: 100 });
    expect(t(parseNotifications(dump(old)))).toEqual([]);
    expect(t(parseNotifications(dump(old)))).toEqual([]);
    const summary = record({ pkg: 'com.whatsapp', id: 9, title: 'WhatsApp', when: 300, flags: 'GROUP_SUMMARY' });
    const other = record({ pkg: 'com.reddit.frontpage', id: 3, title: 'Hot post', when: 300 });
    const newer = record({ pkg: 'com.whatsapp', id: 1, title: 'Rahul', when: 200 });
    expect(t(parseNotifications(dump(newer, summary, other)))).toEqual([{ app: 'WhatsApp', from: 'Rahul' }]);
    // "All apps" includes the rest; the bubble never gets the message text.
    const all = createTracker();
    all(parseNotifications(dump(old)), { allApps: true });
    const fresh = all(parseNotifications(dump(newer, other)), { allApps: true });
    expect(fresh).toEqual([{ app: 'Reddit', from: 'Hot post' }, { app: 'WhatsApp', from: 'Rahul' }]);
    expect(JSON.stringify(fresh)).not.toContain('secret');
  });

  it('shortens group titles', () => {
    expect(cleanTitle('Family (3 messages): Mom')).toBe('Family: Mom');
  });

  it('keeps notifications listed after they are cleared on the phone', async () => {
    let records = [record({ pkg: 'com.whatsapp', id: 1, title: 'Rahul', when: 100 })];
    let shown = [];
    const w = createNotificationWatcher({
      adb: async () => dump(...records), getSerial: async () => 'phone', onMessage() {}, onList: (l) => { shown = l; }, log: { warn() {} },
    });
    await w.poll();
    records = [record({ pkg: 'com.flipkart.android', id: 2, title: 'Sale', when: 50 })];
    await w.poll();
    expect(shown.map((n) => [n.title, n.cleared])).toEqual([['Rahul', true], ['Sale', false]]);
  });

  it('clear all hides current notifications until new ones arrive', async () => {
    let records = [record({ pkg: 'com.whatsapp', id: 1, title: 'Rahul', when: 100 })];
    let shown = [];
    const w = createNotificationWatcher({
      adb: async () => dump(...records), getSerial: async () => 'phone', onMessage() {}, onList: (l) => { shown = l; }, log: { warn() {} },
    });
    await w.poll();
    expect(shown).toHaveLength(1);
    w.clear();
    expect(shown).toEqual([]);
    await w.poll();
    expect(shown).toEqual([]); // still on the phone, but cleared here
    records = [...records, record({ pkg: 'org.telegram.messenger', id: 2, title: 'Asha', when: 200 })];
    await w.poll();
    expect(shown.map((n) => n.title)).toEqual(['Asha']);
  });

  it('uses the Bluetooth list instead of adb while the Buddy Link app is connected', async () => {
    const { toRecords } = require('../../electron/phone/bluetooth');
    const adb = vi.fn();
    const onMessage = vi.fn();
    let items = [{ key: '0|com.whatsapp|1|null', pkg: 'com.whatsapp', title: 'Rahul', text: 'hi', when: 100 }];
    let shown = [];
    const w = createNotificationWatcher({
      adb, getSerial: async () => null, enabled: () => false, onMessage, onList: (l) => { shown = l; }, log: { warn() {} },
      getBluetooth: () => ({ id: 'bt:phone', items: toRecords(items) }),
    });
    await w.poll();
    expect(shown.map((n) => [n.app, n.title, n.text])).toEqual([['WhatsApp', 'Rahul', 'hi']]);
    items = [...items, { key: '0|org.telegram.messenger|2|null', pkg: 'org.telegram.messenger', title: 'Asha', when: 200 }];
    await w.poll();
    expect(onMessage).toHaveBeenCalledWith({ app: 'Telegram', from: 'Asha' });
    expect(adb).not.toHaveBeenCalled();
  });

  it('polls through adb and reports new senders', async () => {
    let when = 100;
    const adb = vi.fn(async () => dump(record({ pkg: 'org.telegram.messenger', id: 2, title: 'Asha', when })));
    const onMessage = vi.fn();
    const w = createNotificationWatcher({ adb, getSerial: async () => 'phone', onMessage, log: { warn() {} } });
    await w.poll();
    when = 200;
    await w.poll();
    expect(onMessage).toHaveBeenCalledWith({ app: 'Telegram', from: 'Asha' });
    const [args] = adb.mock.calls[0];
    expect(args.slice(0, 3)).toEqual(['-s', 'phone', 'shell']);
    expect(args[3]).toMatch(/^dumpsys notification --noredact \| grep -E /);
  });
});

describe('phone IPC validation', () => {
  const phone = {
    pair: vi.fn(async () => ({ ok: true })), connect: vi.fn(async () => ({ ok: true })), start: vi.fn(async () => ({})),
    input: vi.fn(() => true), disconnect: vi.fn(async () => true),
  };
  const h = createHandlers({ phone });

  it('accepts valid requests', async () => {
    await h['phone:pair']('192.168.1.20', 37155, '123456');
    expect(phone.pair).toHaveBeenCalledWith('192.168.1.20', 37155, '123456');
    await h['phone:start']('192.168.1.20:41023', { quality: 'high' });
    await h['phone:start']('192.168.1.20:41023', { mode: 'separate', startApp: 'com.whatsapp' });
    expect(() => h['phone:start']('192.168.1.20:41023', { startApp: 'com.x; reboot' })).toThrow();
    h['phone:input']({ kind: 'touch', action: 'DOWN', x: 1, y: 2, width: 1080, height: 2400 });
    expect(phone.input).toHaveBeenCalled();
  });

  it('rejects bad hosts, codes, serials and input', () => {
    expect(() => h['phone:pair']('-x', 37155, '123456')).toThrow();
    expect(() => h['phone:pair']('192.168.1.20', 37155, '12ab56')).toThrow();
    expect(() => h['phone:connect']('192.168.1.20', 70000)).toThrow();
    expect(() => h['phone:start']('-s evil', {})).toThrow();
    expect(() => h['phone:disconnect']('a b')).toThrow();
    expect(() => h['phone:input']({ kind: 'shell', cmd: 'rm' })).toThrow();
    expect(() => h['phone:input']({ kind: 'text', text: '' })).toThrow();
  });
});

describe('Buddy Link bluetooth messages', () => {
  const { parseLine, toRecords } = require('../../electron/phone/bluetooth');

  it('reads only well-formed bridge lines', () => {
    expect(parseLine('{"t":"hello","model":"RMX5030"}')).toEqual({ t: 'hello', model: 'RMX5030' });
    expect(parseLine('garbage')).toBeNull();
    expect(parseLine('{"t":')).toBeNull();
    expect(parseLine('{"x":1}')).toBeNull();
  });

  it('turns the phone list into watcher records and drops bad entries', () => {
    expect(toRecords([
      { key: 'k', pkg: 'com.whatsapp', title: 'A', text: '', when: '5', summary: 1 },
      { pkg: 'no.key' }, null,
    ])).toEqual([{ key: 'k', pkg: 'com.whatsapp', when: 5, title: 'A', text: null, subText: null, summary: true, ongoing: false }]);
    expect(toRecords('nope')).toEqual([]);
  });
});
