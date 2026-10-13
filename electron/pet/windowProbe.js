// Asks a long-running PowerShell helper (capture/windows.ps1) where other
// windows are, so the buddy can sit on top of them. One process is kept for
// the app's lifetime instead of paying PowerShell's start-up cost per query.
const path = require('path');
const { spawn } = require('child_process');

const TIMEOUT_MS = 4000;
const helperPath = () => path.join(__dirname, '../capture/windows.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

function createWindowProbe({ log, platform = process.platform }) {
  let proc = null;
  let buf = '';
  let waiting = [];   // resolvers, answered in order
  let broken = false; // stop retrying after repeated failures
  let failures = 0;

  function reset() {
    for (const w of waiting) w.resolve(null);
    waiting = [];
    buf = '';
    if (proc) { try { proc.kill(); } catch { /* already gone */ } }
    proc = null;
    if (++failures >= 3) broken = true;
  }

  function ensure() {
    if (proc || broken || platform !== 'win32') return !!proc;
    try {
      proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath()], { windowsHide: true });
    } catch (err) {
      log.warn('window probe failed to start', { error: err.message });
      broken = true;
      return false;
    }
    proc.stdin.on('error', () => reset()); // helper died mid-write
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const w = waiting.shift();
        if (!w) continue;
        clearTimeout(w.timer);
        try { w.resolve(JSON.parse(line)); } catch { w.resolve(null); }
      }
    });
    proc.on('error', (err) => { log.warn('window probe error', { error: err.message }); reset(); });
    proc.on('exit', () => { proc = null; for (const w of waiting) w.resolve(null); waiting = []; });
    return true;
  }

  function ask(cmd) {
    return new Promise((resolve) => {
      if (!ensure()) return resolve(null);
      const w = { resolve };
      w.timer = setTimeout(() => { log.warn('window probe timed out'); reset(); }, TIMEOUT_MS);
      waiting.push(w);
      proc.stdin.write(`${cmd}\n`);
    });
  }

  const usable = (r) => (r && !r.gone && !r.error ? r : null);

  return {
    foreground: async () => usable(await ask('fg')),
    rect: async (hwnd) => {
      const r = await ask(`rect ${Math.trunc(Number(hwnd))}`);
      return r && r.gone ? { gone: true } : usable(r);
    },
    dispose() { if (proc) { try { proc.stdin.end(); proc.kill(); } catch { /* ignore */ } proc = null; } },
  };
}

module.exports = { createWindowProbe };
