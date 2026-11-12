// Bundles the web server (Express included) into one dependency-free file for Docker.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  // import.meta is empty in CommonJS; config.ts resolves paths from its own folder.
  define: { 'import.meta.dirname': '__dirname' },
  logLevel: 'warning',
});
