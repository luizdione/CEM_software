import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const base = dirname(fileURLToPath(import.meta.url));

// @cem/* workspace packages are bundled into the main process so the packaged
// app does not depend on workspace symlinks. Their third-party deps stay
// external (electron-builder ships node_modules).
const bundledDeps = [
  '@cem/shared',
  '@cem/core',
  '@cem/crypto',
  '@cem/scanner',
  '@cem/markdown',
  '@cem/mcp',
  '@cem/profiles',
  '@cem/diagnostics',
  '@cem/backup',
  '@cem/restore',
  '@cem/sync',
  '@cem/usage',
  '@cem/server-inventory',
  // Third-party deps of the @cem packages: bundle them too so the packaged
  // main process is self-contained and needs no runtime node_modules.
  'hash-wasm',
  'fflate',
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledDeps })],
    build: {
      outDir: resolve(base, 'out/main'),
      rollupOptions: { input: resolve(base, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(base, 'out/preload'),
      rollupOptions: {
        input: resolve(base, 'src/preload/index.ts'),
        output: { format: 'es', entryFileNames: '[name].mjs' },
      },
    },
  },
  renderer: {
    root: resolve(base, 'src/renderer'),
    resolve: {
      alias: { '@renderer': resolve(base, 'src/renderer/src') },
    },
    plugins: [react()],
    build: {
      outDir: resolve(base, 'out/renderer'),
      rollupOptions: { input: resolve(base, 'src/renderer/index.html') },
    },
  },
});
