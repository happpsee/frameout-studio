import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAI } from '../worker/api.mjs';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT) || 4188;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  const controller = new AbortController();
  req.on('aborted', () => controller.abort());
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/ai') {
      const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req), duplex: 'half', signal: controller.signal });
      const response = await handleAI(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
      return;
    }
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const directory = relative.startsWith('/tests/') ? root : path.join(root, 'web');
    const filename = path.resolve(directory, '.' + relative);
    if (!filename.startsWith(directory + path.sep) || relative.includes('/.')) { res.writeHead(404); res.end(); return; }
    const bytes = await readFile(filename);
    res.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(bytes);
  } catch (_) { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`FRAMEOUT 本地预览 http://127.0.0.1:${port}`));
