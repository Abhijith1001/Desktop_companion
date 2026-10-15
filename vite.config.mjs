import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The React app is the task-manager window. Electron loads dist/index.html
// in production and the dev server (VITE_DEV_SERVER_URL) during development.
export default defineConfig({
  root: 'src',
  base: './',
  // Sprite character poses, shared with the pet window (electron/pet/public).
  publicDir: '../electron/pet/public',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true, target: 'chrome130' },
  server: { port: 5173, strictPort: true },
});
