import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const assets = {};
async function collect(directory, prefix = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const relative = prefix + '/' + entry.name;
    if (entry.isDirectory()) { await collect(path.join(directory, entry.name), relative); continue; }
    const ext = path.extname(entry.name);
    if (!types[ext]) continue;
    const bytes = await readFile(path.join(directory, entry.name));
    const binary = ['.png', '.webp', '.woff2'].includes(ext);
    assets[relative] = { type: types[ext], binary, data: bytes.toString(binary ? 'base64' : 'utf8'), etag: '"' + createHash('sha256').update(bytes).digest('hex').slice(0, 24) + '"' };
  }
}
await collect(path.join(root, 'web'));
const api = (await readFile(path.join(root, 'worker/api.mjs'), 'utf8')).replace(/^export (?=(?:async )?function|const )/gm, '');
const template = await readFile(path.join(root, 'worker/index.js'), 'utf8');
const output = template.replace("import { handleAI } from './api.mjs';", api).replace('/*__ASSETS__*/ null', JSON.stringify(assets));
const manifest = JSON.parse(await readFile(path.join(root, '.openai/hosting.json'), 'utf8'));
if (manifest.static) throw new Error('Worker manifest must omit static');
await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(path.join(root, 'dist/server'), { recursive: true });
await mkdir(path.join(root, 'dist/.openai'), { recursive: true });
await writeFile(path.join(root, 'dist/server/index.js'), output);
await writeFile(path.join(root, 'dist/.openai/hosting.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`已打包 ${Object.keys(assets).length} 个静态资源与 API 转发层`);
