// Bundles the MCP server into one dependency-free file inside the plugin, so the plugin works
// once copied wherever Claude Code installs it.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: '../../plugins/frameout/server/frameout-mcp.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
