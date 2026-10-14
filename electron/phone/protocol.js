// scrcpy wire protocol (server v3.3): the video stream the phone sends and
// the control messages we send back. Pure functions so they can be tested
// without a phone. Reference: scrcpy app/src/demuxer.c and control_msg.c.
const SCRCPY_VERSION = '3.3.4';

const DEVICE_NAME_LENGTH = 64;
const CODEC_META_LENGTH = 12;
const FRAME_HEADER_LENGTH = 12;
const FLAG_CONFIG = 1n << 63n;
const FLAG_KEY_FRAME = 1n << 62n;
const PTS_MASK = FLAG_KEY_FRAME - 1n;
const MAX_PACKET = 16 * 1024 * 1024;

const CODEC_H264 = 0x68323634; // "h264"

const MSG = {
  INJECT_KEYCODE: 0, INJECT_TEXT: 1, INJECT_TOUCH: 2, INJECT_SCROLL: 3, BACK_OR_SCREEN_ON: 4,
  EXPAND_NOTIFICATIONS: 5, EXPAND_SETTINGS: 6, COLLAPSE_PANELS: 7, GET_CLIPBOARD: 8, SET_CLIPBOARD: 9,
  SET_DISPLAY_POWER: 10, ROTATE_DEVICE: 11, RESET_VIDEO: 17,
};
const ACTION = { DOWN: 0, UP: 1, MOVE: 2 };
const POINTER_FINGER = -2n; // scrcpy's "generic finger": injected as a touch, not a mouse
const MAX_TEXT = 300;

// Android KeyEvent codes for the keys we forward.
const KEYCODE = {
  HOME: 3, BACK: 4, VOLUME_UP: 24, VOLUME_DOWN: 25, POWER: 26, DPAD_UP: 19, DPAD_DOWN: 20, DPAD_LEFT: 21,
  DPAD_RIGHT: 22, TAB: 61, ENTER: 66, DEL: 67, ESCAPE: 111, FORWARD_DEL: 112, MOVE_HOME: 122, MOVE_END: 123,
  PAGE_UP: 92, PAGE_DOWN: 93, APP_SWITCH: 187,
};
const META = { SHIFT: 0x1, ALT: 0x2, CTRL: 0x1000 };

// Incremental parser for the video socket (after the dummy byte):
//   64-byte device name, 12-byte codec meta, then [12-byte header][payload]…
// Config packets (SPS/PPS) are merged into the next packet, as the decoder
// wants them in front of the key frame.
function createVideoParser(emit) {
  let buf = Buffer.alloc(0);
  let state = 'device';
  let header = null;
  let pendingConfig = null;

  // Chunks wait in a list until the current step has enough bytes, so a big
  // key frame arriving in many TCP chunks is copied once, not once per chunk.
  let waiting = [];
  let waitingBytes = 0;
  const needed = () => ({ device: DEVICE_NAME_LENGTH, codec: CODEC_META_LENGTH, header: FRAME_HEADER_LENGTH })[state] ?? header.size;

  function take(n) { const out = buf.subarray(0, n); buf = buf.subarray(n); return out; }

  return function push(chunk) {
    waiting.push(chunk);
    waitingBytes += chunk.length;
    if (buf.length + waitingBytes < needed()) return;
    buf = Buffer.concat(buf.length ? [buf, ...waiting] : waiting);
    waiting = [];
    waitingBytes = 0;
    for (;;) {
      if (state === 'device') {
        if (buf.length < DEVICE_NAME_LENGTH) return;
        const raw = take(DEVICE_NAME_LENGTH);
        const end = raw.indexOf(0);
        emit({ type: 'device', name: raw.subarray(0, end < 0 ? raw.length : end).toString('utf8') });
        state = 'codec';
      } else if (state === 'codec') {
        if (buf.length < CODEC_META_LENGTH) return;
        const meta = take(CODEC_META_LENGTH);
        const codecId = meta.readUInt32BE(0);
        if (codecId !== CODEC_H264) throw new Error(`Unsupported video codec 0x${codecId.toString(16)}`);
        emit({ type: 'codec', codec: 'h264', width: meta.readUInt32BE(4), height: meta.readUInt32BE(8) });
        state = 'header';
      } else if (state === 'header') {
        if (buf.length < FRAME_HEADER_LENGTH) return;
        const h = take(FRAME_HEADER_LENGTH);
        const ptsFlags = h.readBigUInt64BE(0);
        const size = h.readUInt32BE(8);
        if (size === 0 || size > MAX_PACKET) throw new Error(`Bad video packet size ${size}`);
        header = { config: (ptsFlags & FLAG_CONFIG) !== 0n, key: (ptsFlags & FLAG_KEY_FRAME) !== 0n, pts: Number(ptsFlags & PTS_MASK), size };
        state = 'payload';
      } else {
        if (buf.length < header.size) return;
        // Copy: the parser's buffer is reused, the frame outlives this call.
        const data = Buffer.from(take(header.size));
        if (header.config) {
          pendingConfig = data;
        } else {
          const merged = pendingConfig ? Buffer.concat([pendingConfig, data]) : data;
          emit({ type: 'frame', data: merged, key: header.key || !!pendingConfig, pts: header.pts });
          pendingConfig = null;
        }
        state = 'header';
      }
    }
  };
}

// Messages the phone sends on the control socket. Returns whatever whole
// messages are buffered; unknown types stop parsing (the rest is ignored).
function createDeviceMessageParser(emit) {
  let buf = Buffer.alloc(0);
  let broken = false;
  return function push(chunk) {
    if (broken) return;
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 1) return;
      const type = buf[0];
      if (type === 0) { // clipboard
        if (buf.length < 5) return;
        const len = buf.readUInt32BE(1);
        if (buf.length < 5 + len) return;
        emit({ type: 'clipboard', text: buf.subarray(5, 5 + len).toString('utf8') });
        buf = buf.subarray(5 + len);
      } else if (type === 1) { // clipboard ack
        if (buf.length < 9) return;
        buf = buf.subarray(9);
      } else {
        broken = true;
        return;
      }
    }
  };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const u16 = (n) => clamp(Math.round(n), 0, 0xffff);

function writePosition(b, offset, { x, y, width, height }) {
  b.writeInt32BE(Math.round(x), offset);
  b.writeInt32BE(Math.round(y), offset + 4);
  b.writeUInt16BE(u16(width), offset + 8);
  b.writeUInt16BE(u16(height), offset + 10);
}

// Float in [-1, 1] → signed 16-bit fixed point (scrcpy sc_float_to_i16fp).
const toI16fp = (f) => clamp(Math.round(clamp(f, -1, 1) * 0x8000), -0x8000, 0x7fff);

function touch({ action, x, y, width, height, pressure = action === ACTION.UP ? 0 : 1 }) {
  const b = Buffer.alloc(32);
  b[0] = MSG.INJECT_TOUCH;
  b[1] = action;
  b.writeBigInt64BE(POINTER_FINGER, 2);
  writePosition(b, 10, { x, y, width, height });
  b.writeUInt16BE(pressure >= 1 ? 0xffff : Math.round(clamp(pressure, 0, 1) * 0x10000), 22);
  b.writeInt32BE(0, 24); // action button
  b.writeInt32BE(0, 28); // buttons
  return b;
}

// hscroll/vscroll are in wheel "clicks", clamped to ±16 like the scrcpy client.
function scroll({ x, y, width, height, hscroll = 0, vscroll = 0 }) {
  const b = Buffer.alloc(21);
  b[0] = MSG.INJECT_SCROLL;
  writePosition(b, 1, { x, y, width, height });
  b.writeInt16BE(toI16fp(clamp(hscroll, -16, 16) / 16), 13);
  b.writeInt16BE(toI16fp(clamp(vscroll, -16, 16) / 16), 15);
  b.writeInt32BE(0, 17);
  return b;
}

function keycode({ action, keycode: code, repeat = 0, metastate = 0 }) {
  const b = Buffer.alloc(14);
  b[0] = MSG.INJECT_KEYCODE;
  b[1] = action;
  b.writeInt32BE(code, 2);
  b.writeInt32BE(repeat, 6);
  b.writeInt32BE(metastate, 10);
  return b;
}

// Down + up for a single key press.
const keyPress = (code, metastate = 0) => Buffer.concat([
  keycode({ action: ACTION.DOWN, keycode: code, metastate }),
  keycode({ action: ACTION.UP, keycode: code, metastate }),
]);

function truncateUtf8(text, maxBytes) {
  let out = Buffer.from(String(text), 'utf8');
  if (out.length <= maxBytes) return out;
  out = out.subarray(0, maxBytes);
  // Drop a trailing partial multi-byte character.
  let i = out.length - 1;
  while (i > 0 && (out[i] & 0xc0) === 0x80) i--;
  const lead = out[i];
  const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return out.length - i < need ? out.subarray(0, i) : out;
}

function text(str) {
  const body = truncateUtf8(str, MAX_TEXT);
  const b = Buffer.alloc(5 + body.length);
  b[0] = MSG.INJECT_TEXT;
  b.writeUInt32BE(body.length, 1);
  body.copy(b, 5);
  return b;
}

function setClipboard(str, { paste = false, sequence = 0n } = {}) {
  const body = truncateUtf8(str, 256 * 1024);
  const b = Buffer.alloc(14 + body.length);
  b[0] = MSG.SET_CLIPBOARD;
  b.writeBigUInt64BE(BigInt(sequence), 1);
  b[9] = paste ? 1 : 0;
  b.writeUInt32BE(body.length, 10);
  body.copy(b, 14);
  return b;
}

const backOrScreenOn = (action) => Buffer.from([MSG.BACK_OR_SCREEN_ON, action]);
const simple = (type) => Buffer.from([type]);
const setDisplayPower = (on) => Buffer.from([MSG.SET_DISPLAY_POWER, on ? 1 : 0]);

module.exports = {
  SCRCPY_VERSION, MSG, ACTION, KEYCODE, META, MAX_TEXT,
  createVideoParser, createDeviceMessageParser,
  touch, scroll, keycode, keyPress, text, setClipboard, backOrScreenOn, simple, setDisplayPower, truncateUtf8,
};
