// Desktop keyboard → phone input. Printable characters are sent as text
// (so any layout and emoji work); editing and navigation keys as Android
// key codes. Returns null for keys we leave to the desktop.
const KEYCODES = {
  Enter: 66, Backspace: 67, Tab: 61, Delete: 112, Home: 122, End: 123, PageUp: 92, PageDown: 93,
  ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22,
};
const META_SHIFT = 0x1;
const META_ALT = 0x2;
const META_CTRL = 0x1000;

export function mapKey(e) {
  if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'v') return { paste: true };
  if (e.key === 'Escape') return { button: 'back' };
  const keycode = KEYCODES[e.key];
  if (keycode != null) {
    const metastate = (e.shiftKey ? META_SHIFT : 0) | (e.altKey ? META_ALT : 0) | (e.ctrlKey ? META_CTRL : 0);
    return { keycode, metastate };
  }
  // Ctrl+A / Ctrl+C / Ctrl+X etc. on the phone: letters as key codes with Ctrl.
  if (e.ctrlKey && !e.altKey && /^[a-z]$/i.test(e.key)) {
    return { keycode: 29 + e.key.toLowerCase().charCodeAt(0) - 97, metastate: META_CTRL };
  }
  // AltGr reports ctrl+alt on Windows; it still produces a character.
  const altGr = e.ctrlKey && e.altKey;
  if (e.key.length >= 1 && [...e.key].length === 1 && (!e.ctrlKey || altGr) && !e.metaKey) return { text: e.key };
  return null;
}
