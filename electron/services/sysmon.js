// System vitals for the buddy: RAM, free disk, CPU load and (where the OS
// exposes it) temperature. "Hot" means the machine is struggling, which the
// buddy shows by getting angry and catching fire.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const POLL_MS = 5000;
const TEMP_POLL_MS = 30_000;
const LIMITS = { tempC: 85, cpu: 95, ram: 95, diskFreePct: 5 };

function createSysmon({ log, onChange = () => {} }) {
  let timer = null;
  let tempTimer = null;
  let lastCpu = cpuTimes();
  let busyStreak = 0;       // consecutive polls at high CPU, so a spike alone isn't "overheating"
  let tempC = null;
  let tempSupported = true;
  let state = { ram: 0, ramUsedGB: 0, ramTotalGB: 0, cpu: 0, diskFreeGB: null, diskFreePct: null, tempC: null, hot: false, reasons: [] };

  function cpuTimes() {
    let idle = 0; let total = 0;
    for (const c of os.cpus()) {
      for (const v of Object.values(c.times)) total += v;
      idle += c.times.idle;
    }
    return { idle, total };
  }

  function disk() {
    try {
      const root = process.platform === 'win32' ? path.parse(process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\').root : '/';
      const s = fs.statfsSync(root);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      return { freeGB: free / 1e9, freePct: total ? (free / total) * 100 : null };
    } catch { return { freeGB: null, freePct: null }; }
  }

  // Windows only exposes thermal zones through WMI, often only to admins.
  // One failure turns the probe off for the session.
  function readTemp() {
    if (!tempSupported) return;
    if (process.platform === 'win32') {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Measure-Object -Property CurrentTemperature -Maximum).Maximum'],
      { timeout: 8000, windowsHide: true }, (err, out) => {
        const raw = Number(String(out).trim());
        if (err || !raw) { tempSupported = false; tempC = null; return; }
        tempC = raw / 10 - 273.15;
      });
    } else if (process.platform === 'linux') {
      fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8', (err, out) => {
        if (err) { tempSupported = false; return; }
        tempC = Number(out) / 1000;
      });
    } else {
      tempSupported = false;
    }
  }

  function poll() {
    const now = cpuTimes();
    const dTotal = now.total - lastCpu.total;
    const cpu = dTotal > 0 ? (1 - (now.idle - lastCpu.idle) / dTotal) * 100 : 0;
    lastCpu = now;
    busyStreak = cpu >= LIMITS.cpu ? busyStreak + 1 : 0;

    const total = os.totalmem();
    const used = total - os.freemem();
    const ram = (used / total) * 100;
    const d = disk();

    const reasons = [];
    if (tempC != null && tempC >= LIMITS.tempC) reasons.push(`${Math.round(tempC)}°C`);
    if (busyStreak >= 3) reasons.push('CPU maxed');
    // Compared on the rounded value the hint shows, so "RAM 94%" never burns.
    if (Math.round(ram) >= LIMITS.ram) reasons.push('RAM full');
    if (d.freePct != null && d.freePct < LIMITS.diskFreePct) reasons.push('disk almost full');

    const prevHot = state.hot;
    state = {
      ram: Math.round(ram), ramUsedGB: used / 2 ** 30, ramTotalGB: total / 2 ** 30,
      cpu: Math.round(cpu), diskFreeGB: d.freeGB, diskFreePct: d.freePct,
      tempC: tempC == null ? null : Math.round(tempC), hot: reasons.length > 0, reasons,
    };
    if (state.hot !== prevHot) log?.info?.('system vitals', { hot: state.hot, reasons });
    onChange(state);
  }

  return {
    start() {
      if (timer) return;
      readTemp();
      tempTimer = setInterval(readTemp, TEMP_POLL_MS);
      timer = setInterval(poll, POLL_MS);
      setTimeout(poll, 1000);
    },
    stop() { clearInterval(timer); clearInterval(tempTimer); timer = tempTimer = null; },
    current: () => state,
    // One line for the hover hint.
    line() {
      const s = state;
      const parts = [`🧠 RAM ${s.ram}% (${s.ramUsedGB.toFixed(1)}/${s.ramTotalGB.toFixed(0)} GB)`, `⚙️ CPU ${s.cpu}%`];
      if (s.diskFreeGB != null) parts.push(`💾 ${s.diskFreeGB.toFixed(0)} GB free`);
      if (s.tempC != null) parts.push(`🌡️ ${s.tempC}°C`);
      return parts.join(' · ');
    },
  };
}

module.exports = { createSysmon, LIMITS };
