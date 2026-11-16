// The task engine over HTTP, with an SSE event stream (docs/architecture/task-engine.md §4.6).
// Desktop only. Never log a request body: it carries the API key.
import fs from 'node:fs/promises';
import express, { type Request, type RequestHandler, type Response } from 'express';
import { OFFICIAL_BASE_URLS } from '@frameout/shared';
import { apiKeyOf, failure, officialProvider, RelayError, send } from '../relay.ts';
import type { Engine, EngineEvent } from './engine.ts';
import { resultPath, type ImageFile, type ImageRequest } from './execute-image.ts';
import type { VideoRequest } from './execute-video.ts';
import { EngineError, type TaskView } from './task.ts';

const ENGINE_STATUS: Record<string, number> = {
  INVALID_TASK: 400,
  NOT_FOUND: 404,
  NOT_CANCELLABLE: 409,
  NOT_FINISHED: 409,
  INVALID_TRANSITION: 409,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The request holds the prompt and reference images, which the page already has. Left out to keep events small. */
const view = ({ request: _request, ...task }: TaskView) => task;
const ok = (res: Response, value: unknown) =>
  send(res, { status: 200, body: JSON.stringify(value) });
const invalid = (message: string) => new RelayError(400, 'INVALID_REQUEST', message);

function readImageRequest(value: unknown): ImageRequest {
  if (!isObject(value) || typeof value.prompt !== 'string' || typeof value.size !== 'string')
    throw invalid('生成参数不正确');
  const { prompt, size, references } = value;
  if (references === undefined) return { prompt, size };
  if (!Array.isArray(references) || !references.every(item => typeof item === 'string'))
    throw invalid('参考图格式不正确');
  return { prompt, size, references };
}

function readVideoRequest(value: unknown): VideoRequest {
  if (
    !isObject(value) ||
    typeof value.prompt !== 'string' ||
    typeof value.ratio !== 'string' ||
    typeof value.resolution !== 'string' ||
    typeof value.duration !== 'number' ||
    (value.reference !== undefined && typeof value.reference !== 'string')
  )
    throw invalid('生成参数不正确');
  const { prompt, ratio, resolution, duration, reference } = value;
  return { prompt, ratio, resolution, duration, ...(reference ? { reference } : {}) };
}

/** Turns the errors a caller can cause into replies; anything else goes to the app's error handler. */
const handle =
  (route: (req: Request, res: Response) => unknown): RequestHandler =>
  async (req, res) => {
    try {
      await route(req, res);
    } catch (error) {
      if (error instanceof RelayError) send(res, failure(error.status, error.code, error.message));
      else if (error instanceof EngineError)
        send(res, failure(ENGINE_STATUS[error.code] ?? 500, error.code, error.message));
      else throw error;
    }
  };

/** Mounted at /api/tasks after a JSON body parser. `ready` is the engine's start(). */
export function taskRoutes(
  engine: Engine,
  directory: string,
  ready: Promise<void>,
): express.Router {
  // Requests wait for it and report its failure; this only stops it crashing the process first.
  ready.catch(() => {});
  const router = express.Router();
  router.use(async (_req, _res, next) => {
    await ready;
    next();
  });

  router.post(
    '/',
    handle(async (req, res) => {
      const body: unknown = req.body;
      if (!isObject(body)) throw invalid('请求格式不正确');
      const provider = officialProvider(body);
      const apiKey = apiKeyOf(body);
      const { id, model, context } = body;
      const kind = body.kind === 'video' ? 'video' : 'image';
      if (typeof model !== 'string' || !model || model.length > 200) throw invalid('模型名无效');
      const task = await engine.add(
        {
          id: typeof id === 'string' ? id : '',
          kind,
          provider,
          baseUrl: OFFICIAL_BASE_URLS[provider],
          model,
          request:
            kind === 'video' ? readVideoRequest(body.request) : readImageRequest(body.request),
          context,
        },
        apiKey,
      );
      ok(res, { task: view(task) });
    }),
  );

  router.post(
    '/keys',
    handle((req, res) => {
      const body: unknown = req.body;
      if (!isObject(body)) throw invalid('请求格式不正确');
      const provider = officialProvider(body);
      const apiKey = body.apiKey === null ? null : apiKeyOf(body);
      engine.setKey(provider, OFFICIAL_BASE_URLS[provider], apiKey);
      ok(res, { ok: true });
    }),
  );

  router.get('/', (_req, res) => ok(res, { tasks: engine.list().map(view) }));

  router.get('/events', (_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    const write = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    write({ type: 'snapshot', tasks: engine.list().map(view) });
    const stop = engine.subscribe((event: EngineEvent) =>
      write(event.type === 'task' ? { type: 'task', task: view(event.task) } : event),
    );
    res.on('close', stop);
  });

  router.post(
    '/:id/cancel',
    handle(async (req, res) => ok(res, { task: view(await engine.cancel(String(req.params.id))) })),
  );

  router.get(
    '/:id/result',
    handle((req, res) => {
      const task = engine.list().find(item => item.id === req.params.id);
      if (!task) throw new EngineError('NOT_FOUND', '找不到这个任务');
      if (task.status !== 'succeeded') throw new EngineError('NOT_FINISHED', '任务还没有结果');
      const { mime } = task.result as ImageFile;
      // dotfiles: the user-data folder is under ~/.config on Linux.
      res
        .type(mime)
        .set('cache-control', 'no-store')
        .sendFile(resultPath(directory, task.id), { dotfiles: 'allow' }, error => {
          if (error && !res.headersSent)
            send(res, failure(404, 'RESULT_MISSING', '结果文件不存在，请重新生成'));
        });
    }),
  );

  router.post(
    '/:id/ack',
    handle(async (req, res) => {
      const id = String(req.params.id);
      await engine.acknowledge(id);
      await fs.rm(resultPath(directory, id), { force: true });
      ok(res, { ok: true });
    }),
  );

  return router;
}
