// Bundles the Electron main process, the sandboxed preload and the API server process into dist/.
import { build } from 'esbuild';
import { BUNDLES } from './bundles.ts';

await Promise.all(BUNDLES.map(options => build(options)));
