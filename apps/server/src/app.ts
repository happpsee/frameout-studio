import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import express, {
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { RELAY_PATH } from '@frameout/shared';
import type { Settings } from './config.ts';
import { failure, handleAi, type FetchImpl, type Reply } from './relay.ts';

const ALLOWED_METHODS = ['GET', 'POST'];
// CORS-safelisted request headers plus Content-Type, the one header the frontend sends.
const ALLOWED_HEADERS = ['Accept', 'Accept-Language', 'Content-Language', 'Content-Type'];
const ALLOWED_HEADER_SET = new Set(ALLOWED_HEADERS.map(value => value.toLowerCase()));
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
};

function send(req: Request, res: Response, reply: Reply): void {
  if (res.headersSent || res.destroyed) return;
  res.status(reply.status).set({ ...reply.headers, 'content-length': String(reply.body.length) });
  res.end(req.method === 'HEAD' ? undefined : reply.body);
}

const reject =
  (status: number, code: string, message: string): RequestHandler =>
  (req, res) =>
    send(req, res, failure(status, code, message));

const isInside = (directory: string, target: string) =>
  target === directory || target.startsWith(directory + path.sep);

async function fileStat(file: string): Promise<fs.Stats | null> {
  try {
    const stat = await fs.promises.stat(file);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

async function sendFile(
  req: Request,
  res: Response,
  file: string,
  stat: fs.Stats,
  extra: Record<string, string> = {},
): Promise<void> {
  res.status(200).set({
    'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(stat.size),
    'last-modified': stat.mtime.toUTCString(),
    ...extra,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  await pipeline(fs.createReadStream(file), res).catch(() => res.destroy());
}

/** Rejects requests whose Host is not allowed (desktop: loopback only, against DNS rebinding). */
function trustedHost(allowedHosts: readonly string[]): RequestHandler {
  return (req, res, next) => {
    const raw = `http://${req.headers.host ?? ''}`;
    const host = URL.canParse(raw) ? new URL(raw).hostname : '';
    if (allowedHosts.includes(host)) return next();
    send(req, res, failure(400, 'INVALID_HOST', '请求地址无效'));
  };
}

/** Exact-origin CORS: answers preflights and labels allowed simple requests. Never a wildcard or credentials. */
function cors(settings: Settings): RequestHandler {
  return (req, res, next) => {
    const { origin } = req.headers;
    const requestMethod = req.headers['access-control-request-method'];
    if (req.method === 'OPTIONS' && origin !== undefined && requestMethod !== undefined) {
      const requested = String(req.headers['access-control-request-headers'] ?? '')
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean);
      const ok =
        settings.allowedOrigins.has(origin) &&
        ALLOWED_METHODS.includes(requestMethod) &&
        requested.every(value => ALLOWED_HEADER_SET.has(value));
      res.set({ vary: 'Origin', 'content-type': 'text/plain; charset=utf-8' });
      if (!ok) {
        res.status(400).end('Disallowed CORS request');
        return;
      }
      res
        .status(200)
        .set({
          'access-control-allow-origin': origin,
          'access-control-allow-methods': ALLOWED_METHODS.join(', '),
          'access-control-allow-headers': ALLOWED_HEADERS.join(', '),
          'access-control-max-age': '600',
        })
        .end('OK');
      return;
    }
    if (origin !== undefined && settings.allowedOrigins.has(origin))
      res.set({ 'access-control-allow-origin': origin, vary: 'Origin' });
    next();
  };
}

/**
 * Serves the built UI with an SPA fallback. Not express.static: that follows
 * symlinks out of the build and lets "%2e%2e" fall through to the SPA page.
 */
function frontend(settings: Settings): RequestHandler {
  return async (req, res) => {
    const directory = path.resolve(settings.frontendDist);
    // Decode the raw path without URL normalization so "%2e%2e" stays a ".." segment.
    let relative: string;
    try {
      relative = decodeURIComponent(req.path).slice(1);
    } catch {
      return send(req, res, failure(404, 'NOT_FOUND', '文件不存在'));
    }
    // Never expose hidden build files, and treat any ".." segment as hidden.
    if (relative.includes('\0') || relative.split(/[\\/]/).some(part => part.startsWith('.'))) {
      return send(req, res, failure(404, 'NOT_FOUND', '文件不存在'));
    }
    const target = path.resolve(directory, relative);
    if (!isInside(directory, target))
      return send(req, res, failure(404, 'NOT_FOUND', '文件不存在'));
    if (relative) {
      const stat = await fileStat(target);
      if (stat) {
        // Resolve symlinks before serving so a link cannot point outside the build.
        const [real, realDirectory] = await Promise.all([
          fs.promises.realpath(target),
          fs.promises.realpath(directory),
        ]);
        if (!isInside(realDirectory, real))
          return send(req, res, failure(404, 'NOT_FOUND', '文件不存在'));
        return sendFile(req, res, target, stat);
      }
    }
    const index = path.join(directory, 'index.html');
    const indexStat = await fileStat(index);
    if (indexStat && (!relative || !path.extname(relative)))
      return sendFile(req, res, index, indexStat, { 'cache-control': 'no-cache' });
    send(
      req,
      res,
      indexStat
        ? failure(404, 'NOT_FOUND', '文件不存在')
        : failure(404, 'FRONTEND_NOT_BUILT', '前端尚未构建，请先运行 pnpm build'),
    );
  };
}

export interface AppOptions {
  fetch?: FetchImpl;
}

export function createApp(
  settings: Settings,
  { fetch: fetchImpl = globalThis.fetch }: AppOptions = {},
): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');

  if (settings.allowedHosts) app.use(trustedHost(settings.allowedHosts));
  app.use(cors(settings));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'frameout-api' });
  });
  // No body parser: the relay reads and validates the raw body itself (size, UTF-8, finite numbers).
  app.post(RELAY_PATH, async (req, res) => {
    const reply = await handleAi(req, res, settings, fetchImpl);
    if (reply) send(req, res, reply);
    else res.destroy();
  });
  app.all(RELAY_PATH, reject(405, 'METHOD_NOT_ALLOWED', '请使用 POST 请求'));
  app.all(['/api/health', '/api/{*rest}'], (req, res) => {
    send(
      req,
      res,
      req.path === '/api/health'
        ? failure(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式')
        : failure(404, 'NOT_FOUND', '接口不存在'),
    );
  });
  app.all('/api', reject(404, 'NOT_FOUND', '接口不存在'));
  app.get('/{*path}', frontend(settings));
  app.use(reject(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式'));

  const onError: ErrorRequestHandler = (error, req, res, _next) => {
    // Never echo internal errors; they can include request data.
    if (res.headersSent) res.destroy();
    // The router fails to decode a malformed path ("%E0%A4%A"): no such route or file.
    else if (error instanceof URIError)
      send(req, res, failure(404, 'NOT_FOUND', '接口或文件不存在'));
    else send(req, res, failure(500, 'INTERNAL_ERROR', '服务内部错误'));
  };
  app.use(onError);
  return app;
}
