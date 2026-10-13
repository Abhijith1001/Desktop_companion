// Launches Electron with a clean environment. Some editors' terminals set
// ELECTRON_RUN_AS_NODE=1, which makes Electron behave like plain Node.
const { spawn } = require('child_process');
const electron = require('electron');

function runElectron(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, ['.'], { stdio: 'inherit', env, cwd: require('path').join(__dirname, '..') });
  child.on('exit', (code) => process.exit(code ?? 0));
  return child;
}

module.exports = { runElectron };
if (require.main === module) runElectron();
