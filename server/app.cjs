'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { failure, handleAi } = require('./relay.cjs');

const ALLOWED_METHODS = new Set(['GET', 'POST']);
// Starlette's CORS safelist plus the one header the frontend sends.
const ALLOWED_HEADERS = ['Accept', 'Accept-Language', 'Content-Language', 'Content-Type'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
};

function send(req, res, reply) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(reply.status, { ...reply.headers, 'content-length': reply.body.length });
  res.end(req.method === 'HEAD' ? undefined : reply.body);
}

function json(status, value) {
  return { status, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) };
}

function isInside(directory, target) {
  return target === directory || target.startsWith(directory + path.sep);
}

async function fileStat(file) {
  try {
    const stat = await fs.promises.stat(file);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

async function sendFile(req, res, file, stat, extra = {}) {
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': stat.size,
    'last-modified': stat.mtime.toUTCString(),
    ...extra,
  });
  if (req.method === 'HEAD') return res.end();
  await pipeline(fs.createReadStream(file), res).catch(() => res.destroy());
}

async function serveFrontend(req, res, pathname, settings) {
  const directory = path.resolve(settings.frontendDist);
  const relative = pathname.slice(1);
  // Never expose hidden build files, and treat any ".." segment as hidden.
  if (relative.includes('\0') || relative.split(/[\\/]/).some(part => part.startsWith('.'))) {
    return send(req, res, failure(404, 'NOT_FOUND', '文件不存在'));
  }
  const target = path.resolve(directory, relative);
  if (!isInside(directory, target)) return send(req, res, failure(404, 'NOT_FOUND', '文件不存在'));
  if (relative) {
    const stat = await fileStat(target);
    if (stat) {
      // Resolve symlinks before serving so a link cannot point outside the build.
      const [real, realDirectory] = await Promise.all([fs.promises.realpath(target), fs.promises.realpath(directory)]);
      if (!isInside(realDirectory, real)) return send(req, res, failure(404, 'NOT_FOUND', '文件不存在'));
      return sendFile(req, res, target, stat);
    }
  }
  const index = path.join(directory, 'index.html');
  const indexStat = await fileStat(index);
  if (indexStat && (!relative || !path.extname(relative))) return sendFile(req, res, index, indexStat, { 'cache-control': 'no-cache' });
  return send(req, res, indexStat
    ? failure(404, 'NOT_FOUND', '文件不存在')
    : failure(404, 'FRONTEND_NOT_BUILT', '前端尚未构建，请先运行 pnpm build'));
}

function preflight(req, res, settings) {
  const origin = req.headers.origin;
  const method = req.headers['access-control-request-method'];
  const requested = String(req.headers['access-control-request-headers'] || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const allowedHeaders = new Set(ALLOWED_HEADERS.map(value => value.toLowerCase()));
  const ok = settings.allowedOrigins.has(origin) && ALLOWED_METHODS.has(method) && requested.every(value => allowedHeaders.has(value));
  if (!ok) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', vary: 'Origin' });
    return res.end('Disallowed CORS request');
  }
  res.writeHead(200, {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': [...ALLOWED_METHODS].join(', '),
    'access-control-allow-headers': ALLOWED_HEADERS.join(', '),
    'access-control-max-age': '600',
    'content-type': 'text/plain; charset=utf-8',
    vary: 'Origin',
  });
  res.end('OK');
}

function createApp(settings, { fetch: fetchImpl = globalThis.fetch } = {}) {
  async function route(req, res) {
    if (settings.allowedHosts) {
      const host = URL.canParse(`http://${req.headers.host}`) ? new URL(`http://${req.headers.host}`).hostname : '';
      if (!settings.allowedHosts.includes(host)) return send(req, res, failure(400, 'INVALID_HOST', '请求地址无效'));
    }
    const { origin } = req.headers;
    if (req.method === 'OPTIONS' && origin !== undefined && req.headers['access-control-request-method'] !== undefined) {
      return preflight(req, res, settings);
    }
    if (origin !== undefined && settings.allowedOrigins.has(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
    }

    // Decode the raw path without URL normalization: "%2e%2e" must stay a
    // ".." segment that serveFrontend rejects, not be silently resolved away.
    let pathname;
    try {
      pathname = decodeURIComponent((req.url || '').split(/[?#]/, 1)[0]);
    } catch {
      pathname = '';
    }
    if (!pathname.startsWith('/')) return send(req, res, failure(404, 'NOT_FOUND', '接口或文件不存在'));

    if (pathname === '/api/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, failure(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式'));
      return send(req, res, json(200, { status: 'ok', service: 'frameout-api' }));
    }
    if (pathname === '/api/ai') {
      if (req.method !== 'POST') return send(req, res, failure(405, 'METHOD_NOT_ALLOWED', '请使用 POST 请求'));
      const reply = await handleAi(req, res, settings, fetchImpl);
      return reply ? send(req, res, reply) : res.destroy();
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) return send(req, res, failure(404, 'NOT_FOUND', '接口不存在'));
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, failure(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式'));
    return serveFrontend(req, res, pathname, settings);
  }

  return (req, res) => {
    route(req, res).catch(() => {
      // Never echo internal errors; they can include request data.
      if (!res.headersSent) send(req, res, failure(500, 'INTERNAL_ERROR', '服务内部错误'));
      else res.destroy();
    });
  };
}

module.exports = { createApp };
