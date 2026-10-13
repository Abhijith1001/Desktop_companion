// Dev mode: Vite dev server with hot reload for the task manager + Electron.
const { createServer } = require('vite');
const { runElectron } = require('./run-electron');

(async () => {
  const server = await createServer({ configFile: require('path').join(__dirname, '../vite.config.mjs') });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  console.log(`Vite dev server: ${url}`);
  const child = runElectron({ VITE_DEV_SERVER_URL: url.replace(/\/$/, '') + '/' });
  child.on('exit', () => server.close());
})();
