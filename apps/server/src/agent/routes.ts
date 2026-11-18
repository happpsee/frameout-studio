// The agent channel (docs/architecture/agent-plugin.md). Two sides:
// - the agent (the frameout MCP server), with the token from agent.json: /call and /files;
// - the app window, same-origin only: /bridge/* takes commands and returns answers.
// Never log a body: files are the user's media.
import { randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type RequestHandler } from 'express';
import { failure, send } from '../relay.ts';
import { AgentBridge, AgentError } from './bridge.ts';

/** Files an agent hands over, kept until the window has read them or for a few minutes. */
const FILE_TTL = 10 * 60_000;
const FILE_LIMIT = 500 * 1024 * 1024;

const ok = (res: express.Response, value: unknown) =>
  send(res, { status: 200, body: JSON.stringify(value) });

function tokenMatches(header: string | undefined, token: string) {
  const given = Buffer.from(header?.replace(/^Bearer /, '') ?? '');
  const wanted = Buffer.from(token);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** Mounted at /api/agent. Unset token, the channel is off. */
export function agentRoutes(token: string, bridge = new AgentBridge()): express.Router {
  const files = new Map<string, { data: Buffer; type: string; timer: NodeJS.Timeout }>();
  const router = express.Router();

  const agentOnly: RequestHandler = (req, res, next) => {
    if (tokenMatches(req.headers.authorization, token)) return next();
    send(res, failure(401, 'AGENT_UNAUTHORIZED', 'Agent 令牌无效，请重新打开帧外'));
  };
  // The page marks its requests as its own (Sec-Fetch-Site; Origin on posts); a program
  // calling the API directly does not. Not a lock against local programs, which the token is.
  const windowOnly: RequestHandler = (req, res, next) => {
    if (req.headers['sec-fetch-site'] === 'same-origin' || req.headers.origin) return next();
    send(res, failure(403, 'WINDOW_ONLY', '只允许帧外窗口调用'));
  };

  router.post('/call', agentOnly, express.json({ limit: '1mb' }), async (req, res) => {
    const { name, args } = (req.body ?? {}) as { name?: unknown; args?: unknown };
    if (typeof name !== 'string' || !name)
      return void send(res, failure(400, 'INVALID_REQUEST', '缺少要调用的操作'));
    try {
      ok(res, { result: await bridge.call(name, args ?? {}) });
    } catch (error) {
      if (!(error instanceof AgentError)) throw error;
      const status = error.code === 'NO_WINDOW' ? 503 : error.code === 'WINDOW_TIMEOUT' ? 504 : 422;
      send(res, failure(status, error.code, error.message));
    }
  });

  router.post(
    '/files',
    agentOnly,
    express.raw({ type: () => true, limit: FILE_LIMIT }),
    (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        return void send(res, failure(400, 'INVALID_REQUEST', '文件是空的'));
      const id = randomUUID();
      const timer = setTimeout(() => files.delete(id), FILE_TTL);
      timer.unref();
      files.set(id, {
        data: req.body,
        type: req.headers['content-type'] || 'application/octet-stream',
        timer,
      });
      ok(res, { fileId: id });
    },
  );

  router.get('/bridge/events', windowOnly, (_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.write(': ready\n\n');
    const stop = bridge.subscribe(command => res.write(`data: ${JSON.stringify(command)}\n\n`));
    res.on('close', stop);
  });

  router.post('/bridge/results/:id', windowOnly, express.json({ limit: '32mb' }), (req, res) => {
    const settled = bridge.settle(String(req.params.id), req.body ?? {});
    if (settled) ok(res, { ok: true });
    else send(res, failure(404, 'NOT_FOUND', '这个操作已经超时或不存在'));
  });

  router.get('/bridge/files/:id', windowOnly, (req, res) => {
    const file = files.get(String(req.params.id));
    if (!file) return void send(res, failure(404, 'NOT_FOUND', '文件已过期，请重新导入'));
    clearTimeout(file.timer);
    files.delete(String(req.params.id));
    res.set({ 'content-type': file.type, 'cache-control': 'no-store' }).send(file.data);
  });

  return router;
}
