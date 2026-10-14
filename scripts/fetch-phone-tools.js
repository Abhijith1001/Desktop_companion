// Downloads the third-party binaries the phone mirror needs into vendor/phone:
//   adb.exe (+ its two DLLs) from Google's Android platform-tools, and the
//   scrcpy server jar (Apache 2.0) that runs on the phone.
// Run once before `npm run dev` / `npm run dist`: node scripts/fetch-phone-tools.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { SCRCPY_VERSION } = require('../electron/phone/protocol');

const OUT = path.join(__dirname, '..', 'vendor', 'phone');
const PLATFORM_TOOLS = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
const SERVER = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-server-v${SCRCPY_VERSION}`;
const SCRCPY_LICENSE = 'https://raw.githubusercontent.com/Genymobile/scrcpy/master/LICENSE';

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const force = process.argv.includes('--force');

  if (force || !fs.existsSync(path.join(OUT, 'adb.exe'))) {
    console.log('Downloading Android platform-tools…');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-pt-'));
    const zip = path.join(tmp, 'pt.zip');
    fs.writeFileSync(zip, await download(PLATFORM_TOOLS));
    // Windows' bsdtar reads zips; Git Bash's GNU tar (if first on PATH) can't.
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    execFileSync(tar, ['-xf', zip, '-C', tmp]);
    for (const f of ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'NOTICE.txt']) {
      const src = path.join(tmp, 'platform-tools', f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, f === 'NOTICE.txt' ? 'platform-tools-NOTICE.txt' : f));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // The server must match SCRCPY_VERSION exactly, so re-download when it changes.
  const versionFile = path.join(OUT, 'scrcpy-version.txt');
  const have = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : null;
  if (force || have !== SCRCPY_VERSION || !fs.existsSync(path.join(OUT, 'scrcpy-server'))) {
    console.log(`Downloading scrcpy-server v${SCRCPY_VERSION}…`);
    fs.writeFileSync(path.join(OUT, 'scrcpy-server'), await download(SERVER));
    fs.writeFileSync(versionFile, SCRCPY_VERSION);
    fs.writeFileSync(path.join(OUT, 'scrcpy-LICENSE.txt'), await download(SCRCPY_LICENSE));
  }
  console.log(`Phone tools ready in ${OUT}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
