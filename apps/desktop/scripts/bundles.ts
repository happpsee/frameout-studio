// The three bundles in dist/, shared by build.ts and dev.ts. Workspace packages
// and Express are inlined, so the app needs no node_modules at runtime.
import type { BuildOptions } from 'esbuild';

const common: BuildOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  // import.meta is empty in CommonJS; the server's config resolves paths from its folder.
  define: { 'import.meta.dirname': '__dirname' },
  logLevel: 'warning',
};

export const BUNDLES: BuildOptions[] = [
  // Electron 45 runs Node 24.
  { ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs', target: 'node24' },
  {
    ...common,
    entryPoints: ['src/server-process.ts'],
    outfile: 'dist/server.cjs',
    target: 'node24',
  },
  // A sandboxed preload can only require "electron", so everything else is inlined.
  { ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', target: 'chrome140' },
];
