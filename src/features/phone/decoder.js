import { avcCodecString } from './avc';

// Most decoded-but-unpainted or queued frames we tolerate before skipping
// ahead to live; anything more is visible lag.
const MAX_QUEUE = 6;

// Decodes the phone's H.264 packets with WebCodecs (hardware where the GPU
// allows) and paints them on a canvas. Built for low latency:
//  - only the newest decoded frame is painted, once per display refresh;
//  - if decoding falls behind, the backlog is dropped and a fresh key frame
//    is requested (onNeedKeyFrame) instead of slowly catching up;
//  - after a decoder error it recovers the same way rather than freezing
//    until the phone's next periodic key frame (up to ~10 s).
export function createDecoder(canvas, { onSize = () => {}, onError = () => {}, onNeedKeyFrame = () => {} } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  let decoder = null;
  let codec = null;
  let waitingForKey = true;
  let latest = null;
  let raf = 0;
  let lastKeyRequest = 0;

  function requestKey() {
    waitingForKey = true;
    const now = performance.now();
    if (now - lastKeyRequest > 500) { lastKeyRequest = now; onNeedKeyFrame(); }
  }

  function paint() {
    raf = 0;
    const frame = latest;
    latest = null;
    if (!frame) return;
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      onSize({ width: w, height: h });
    }
    ctx.drawImage(frame, 0, 0, w, h);
    frame.close();
  }

  function onFrame(frame) {
    // A newer frame replaces one that never got painted.
    if (latest) latest.close();
    latest = frame;
    if (!raf) raf = requestAnimationFrame(paint);
  }

  function reset() {
    try { if (decoder && decoder.state !== 'closed') decoder.close(); } catch { /* already closed */ }
    decoder = null;
    codec = null;
  }

  function configure(nextCodec) {
    reset();
    decoder = new VideoDecoder({
      output: onFrame,
      error: (err) => { onError(err); reset(); requestKey(); },
    });
    // No `description`: packets stay in Annex B form with SPS/PPS in-band.
    decoder.configure({ codec: nextCodec, optimizeForLatency: true });
    codec = nextCodec;
  }

  function push({ data, key, pts }) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (key) {
      // A key frame carrying an SPS can change profile/size (e.g. on rotation).
      const next = avcCodecString(bytes);
      if (next && (next !== codec || !decoder)) configure(next);
      if (decoder) waitingForKey = false;
    }
    if (!decoder || waitingForKey) {
      if (!key) requestKey();
      return;
    }
    // Behind: drop everything queued and jump to live with a new key frame.
    if (!key && decoder.decodeQueueSize > MAX_QUEUE) {
      const c = codec;
      configure(c);
      requestKey();
      return;
    }
    try {
      decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: pts, data: bytes }));
    } catch (err) {
      onError(err);
      reset();
      requestKey();
    }
  }

  function close() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (latest) latest.close();
    latest = null;
    reset();
  }

  return { push, close };
}

export const webCodecsSupported = () => typeof window !== 'undefined' && 'VideoDecoder' in window;
