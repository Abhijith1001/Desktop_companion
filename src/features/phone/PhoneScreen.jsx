import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { createDecoder } from './decoder';
import { mapKey } from './keys';

// The live phone screen: draws frames from the main process and turns mouse,
// wheel and keyboard input on the canvas into touches and key presses.
export default function PhoneScreen({ label, onDecodeError }) {
  const canvasRef = useRef(null);
  const [size, setSize] = useState(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const decoder = createDecoder(canvas, {
      onSize: setSize,
      onError: (err) => onDecodeError?.(err),
      onNeedKeyFrame: () => api.phone.input({ kind: 'reset' }).catch(() => {}),
    });
    const off = api.phone.onFrame((f) => decoder.push(f));
    // Frames only flow while this screen is on show; the session itself keeps
    // running when the window is hidden or another page is open.
    const view = () => api.phone.view(!document.hidden).catch(() => {});
    view();
    document.addEventListener('visibilitychange', view);
    canvas.focus();
    return () => {
      document.removeEventListener('visibilitychange', view);
      api.phone.view(false).catch(() => {});
      off();
      decoder.close();
    };
  }, [onDecodeError]);

  // Canvas pixels are phone-video pixels; map from the scaled on-screen box.
  function position(e) {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return {
      x: Math.min(c.width - 1, Math.max(0, ((e.clientX - r.left) / r.width) * c.width)),
      y: Math.min(c.height - 1, Math.max(0, ((e.clientY - r.top) / r.height) * c.height)),
      width: c.width, height: c.height,
    };
  }

  const send = (evt) => { api.phone.input(evt).catch(() => {}); };

  // Moves are coalesced to one per animation frame.
  const pending = useRef(null);
  const down = useRef(false);
  function flushMove() {
    const p = pending.current;
    pending.current = null;
    if (p && down.current) send({ kind: 'touch', action: 'MOVE', ...p });
  }

  function onPointerDown(e) {
    if (e.button !== 0 || !size) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    down.current = true;
    send({ kind: 'touch', action: 'DOWN', ...position(e) });
  }
  function onPointerMove(e) {
    if (!down.current) return;
    const first = !pending.current;
    pending.current = position(e);
    if (first) requestAnimationFrame(flushMove);
  }
  function onPointerUp(e) {
    if (!down.current) return;
    flushMove();
    down.current = false;
    send({ kind: 'touch', action: 'UP', ...position(e) });
  }

  // Native listener: React's wheel handler is passive and can't stop the page scrolling.
  useEffect(() => {
    const c = canvasRef.current;
    const onWheel = (e) => {
      if (!c.width) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 1 : 1 / 100; // lines vs pixels → wheel clicks
      send({ kind: 'scroll', ...position(e), hscroll: -e.deltaX * unit, vscroll: -e.deltaY * unit });
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);

  function onKeyDown(e) {
    const m = mapKey(e);
    if (!m) return;
    e.preventDefault();
    if (m.paste) send({ kind: 'paste' });
    else if (m.button) send({ kind: 'button', button: m.button });
    else if (m.text) send({ kind: 'text', text: m.text });
    else send({ kind: 'key', action: 'DOWN', keycode: m.keycode, metastate: m.metastate });
  }
  function onKeyUp(e) {
    const m = mapKey(e);
    if (!m || m.keycode == null) return;
    e.preventDefault();
    send({ kind: 'key', action: 'UP', keycode: m.keycode, metastate: m.metastate });
  }

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center">
      <canvas ref={canvasRef} tabIndex={0} aria-label={`${label} screen. Click to tap, scroll to swipe, type to enter text.`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown} onKeyUp={onKeyUp} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onContextMenu={(e) => { e.preventDefault(); send({ kind: 'button', button: 'back' }); }}
        className={`max-h-full max-w-full touch-none rounded-[1.4rem] border-[6px] bg-black shadow-xl outline-none transition-colors ${focused ? 'border-brand-500' : 'border-stone-800'} ${size ? '' : 'h-[60vh] aspect-[9/19]'}`} />
      {!size && <p className="absolute text-sm text-stone-400">Waiting for the first frame…</p>}
    </div>
  );
}
