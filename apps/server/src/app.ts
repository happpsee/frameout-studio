import path from 'node:path';
import express, { type ErrorRequestHandler, type RequestHandler, type Response } from 'express';
import { RELAY_PATH } from '@frameout/shared';
import type { Settings } from './config.ts';
import { failure, relay, type FetchImpl, type Reply } from './relay.ts';

const send = (res: Response, reply: Reply) =>
  res
    .status(reply.status)
    .set({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    .type('json')
    .send(reply.body);

// The page is small and names the current build's files, so it is always revalidated.
const HTML_HEADERS = { 'cache-control': 'no-cache' };

/** Rejects requests whose Host is not allowed (desktop: loopback only, against DNS rebinding). */
function trustedHost(allowedHosts: readonly string[]): RequestHandler {
  return (req, res, next) => {
    const raw = `http://${req.headers.host ?? ''}`;
    const host = URL.canParse(raw) ? new URL(raw).hostname : '';
    if (allowedHosts.includes(host)) return next();
    send(res, failure(400, 'INVALID_HOST', '请求地址无效'));
  };
}

/** A page on another site must not call the API from the user's browser. */
const sameOrigin: RequestHandler = (req, res, next) => {
  const { origin, host } = req.headers;
  if (origin === undefined || (URL.canParse(origin) && new URL(origin).host === host))
    return next();
  send(res, failure(403, 'CROSS_ORIGIN_BLOCKED', '只允许从本站页面发起请求'));
};

export interface AppOptions {
  fetch?: FetchImpl;
}

export function createApp(
  settings: Settings,
  { fetch: fetchImpl = globalThis.fetch }: AppOptions = {},
): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (settings.allowedHosts) app.use(trustedHost(settings.allowedHosts));

  app.use('/api', sameOrigin);
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'frameout-api' });
  });
  app.post(RELAY_PATH, express.json({ limit: settings.requestLimit }), async (req, res) => {
    send(res, await relay(req.body, settings, fetchImpl));
  });
  app.use('/api', (_req, res) => {
    send(res, failure(404, 'NOT_FOUND', '接口不存在'));
  });

  // The built UI. Any path without a file extension is a page of the single-page app.
  const noCacheHtml = (res: Response, file: string) => {
    if (file.endsWith('.html')) res.set(HTML_HEADERS);
  };
  app.use(express.static(settings.frontendDist, { setHeaders: noCacheHtml }));
  app.get('/{*path}', (req, res) => {
    if (path.extname(req.path)) return void send(res, failure(404, 'NOT_FOUND', '文件不存在'));
    res.sendFile('index.html', { root: settings.frontendDist, headers: HTML_HEADERS }, error => {
      if (error) send(res, failure(404, 'FRONTEND_NOT_BUILT', '前端尚未构建，请先运行 pnpm build'));
    });
  });

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) return void res.destroy();
    const type = (error as { type?: unknown } | null)?.type;
    if (type === 'entity.too.large')
      send(res, failure(413, 'BODY_TOO_LARGE', '数据过大，请减小图片或请求大小后重试'));
    else if (type === 'entity.parse.failed')
      send(res, failure(400, 'INVALID_JSON', '请求正文不是有效的 JSON'));
    // Never echo internal errors; they can include request data.
    else send(res, failure(500, 'INTERNAL_ERROR', '服务内部错误'));
  };
  app.use(onError);
  return app;
}
