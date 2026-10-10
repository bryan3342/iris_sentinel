import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// `vite` serves the playground (index.html) on localhost and opens it: a
// full-window gaze tracking view for testing without installing the extension.
// `vite build` emits the unpacked extension into dist/; the playground is not
// part of the build.
export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true, open: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
        permission: resolve(import.meta.dirname, 'permission.html'),
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
      },
      output: {
        // The manifest points at a fixed service worker path.
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
