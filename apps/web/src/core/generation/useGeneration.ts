import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AIConfig,
  Card,
  GenerationMode,
  ProjectState,
  UpdateProject,
  VideoJob,
} from '../../types';
import { createClient, PROVIDER_CAPABILITIES, submitFailure } from '@frameout/shared';
import { PENDING_MEDIA, preferenceOnly, uid } from '../project/project';
import { DesktopMediaTooLargeError, putMedia } from '../project/media-store';
import { GENERATION_MODE_KEY, readStoredValue, writeStoredValue } from '../project/desktop-storage';
import {
  encodeReference,
  referenceCards,
  supportsReferences,
  withNotes,
  withReferenceRoles,
} from './consistency';
import { initialConfig, redact, saveProfile } from '../../shell/settings/preferences';
import { desktopBridge } from '../../platform';
import { CARD_CENTER } from '../canvas/canvas-camera';
import { freeSpot, STEP_X } from '../canvas/canvas-layout';
import { regeneration } from './regenerate';
import { failedImageCard, placeImageCard } from './failed-image';
import type { EngineOutcome, EngineImageRequest, EngineVideoRequest } from './useEngineTasks';
import { giveKey } from './engine-tasks';
import {
  askNotificationPermission,
  useCompletionNotice,
} from '../../shell/misc/useCompletionNotice';

// openSettings shows the API settings with a reason; without it, missing settings fall back to a toast.
type Options = {
  getProject: () => ProjectState;
  update: UpdateProject;
  toast: (message: string) => void;
  openSettings?: (notice: string) => void;
  /** Desktop: generations go to the local task engine (useEngineTasks) instead of running here. */
  engine?: EngineTasks | null;
};
type ActiveTask = { controller: AbortController; cardId?: string };
type EngineTasks = {
  run: (request: EngineImageRequest, signal: AbortSignal) => Promise<EngineOutcome>;
  runVideo: (request: EngineVideoRequest, signal: AbortSignal) => Promise<EngineOutcome>;
};
type VideoResult = {
  id: string;
  status: string;
  src?: string;
  data?: Blob;
  error?: string;
  progress?: number;
};
type VideoClient = {
  getVideo: (options: { id: string; signal: AbortSignal }) => Promise<VideoResult>;
};
type GenerationRequest = {
  prompt: string;
  mode: GenerationMode;
  config?: AIConfig;
  position?: { x: number; y: number };
  /** Place the new card beside this one (used by "再来一张"). */
  near?: Card;
  /** Id of a failed image card the result takes the place of. */
  replace?: string;
  /** Cards linked into the card being generated from; sent instead of the project's references. */
  references?: Card[];
  /** Notes whose words are in the prompt; the new card keeps the lines from them. */
  textIds?: string[];
  onCard?: (id: string) => void;
};
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('已停止等待', 'AbortError'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('已停止等待', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
function initialMode(): GenerationMode {
  try {
    return readStoredValue(GENERATION_MODE_KEY) === 'video' ? 'video' : 'image';
  } catch {
    return 'image';
  }
}

export function useGeneration({ getProject, update, toast, openSettings, engine }: Options) {
  const [mode, setModeState] = useState<GenerationMode>(initialMode);
  const [prompt, setPrompt] = useState('');
  const [config, setConfigState] = useState<AIConfig>(initialConfig);
  const [active, setActive] = useState(false);
  const taskRef = useRef<ActiveTask | null>(null);
  const mounted = useRef(true);
  const urls = useRef(new Set<string>());
  // Encoded reference images by card and source, so a plan does not re-encode them for every shot.
  const encoded = useRef(new Map<string, Promise<string>>());
  const notify = useCompletionNotice();
  const latest = useRef({ getProject, update, toast, openSettings });
  latest.current = { getProject, update, toast, openSettings };
  const needSettings = (notice: string) => {
    if (latest.current.openSettings) latest.current.openSettings(notice);
    else toast(notice);
  };
  function patchJob(id: string, patch: Partial<VideoJob>) {
    latest.current.update(draft => {
      const card = draft.cards.find(c => c.id === id);
      if (card?.job) Object.assign(card.job, patch);
    }, false);
  }
  const stop = useCallback(() => {
    const task = taskRef.current;
    if (!task) return;
    task.controller.abort();
    taskRef.current = null;
    setActive(false);
    if (task.cardId)
      latest.current.update(draft => {
        const job = draft.cards.find(c => c.id === task.cardId)?.job;
        if (job && job.status !== 'succeeded' && job.status !== 'failed') {
          job.status = 'paused';
          job.error = job.id
            ? '已停止本页等待，可继续查询同一任务'
            : '未取得任务号，请先到供应商后台核对';
        }
      }, false);
    latest.current.toast('已停止本页等待；已提交请求仍可能在供应商执行或计费');
  }, []);
  // The engine keeps keys in memory only; after a restart it needs them again to start queued tasks.
  const engineOn = Boolean(engine);
  useEffect(() => {
    if (engineOn && config.key)
      giveKey(config.provider, config.baseUrl, config.key).catch(() => {});
  }, [engineOn, config.provider, config.baseUrl, config.key]);
  useEffect(() => {
    mounted.current = true;
    const createdUrls = urls.current;
    return () => {
      mounted.current = false;
      taskRef.current?.controller.abort();
      taskRef.current = null;
      createdUrls.forEach(url => URL.revokeObjectURL(url));
      createdUrls.clear();
    };
  }, []);
  function current(task: ActiveTask) {
    return mounted.current && taskRef.current === task && !task.controller.signal.aborted;
  }
  function ownsTask(task: ActiveTask): boolean {
    return taskRef.current === task;
  }
  function start(): ActiveTask | null {
    if (taskRef.current) return null;
    const task = { controller: new AbortController() };
    taskRef.current = task;
    setActive(true);
    return task;
  }
  function finish(task: ActiveTask) {
    if (taskRef.current === task) {
      taskRef.current = null;
      if (mounted.current) setActive(false);
    }
  }
  const setConfig = useCallback(
    // A running task keeps the settings it was submitted with: it is paid for and must finish.
    (value: AIConfig) => {
      setConfigState(value);
      saveProfile(value);
    },
    [],
  );
  const setMode = useCallback((value: GenerationMode) => {
    setModeState(value);
    try {
      void writeStoredValue(GENERATION_MODE_KEY, value)?.catch(() => {});
    } catch {
      /* Optional preference. */
    }
  }, []);
  function position(source?: Card) {
    const { camera, cards } = getProject();
    if (source) return freeSpot(cards, { x: source.x + STEP_X, y: source.y });
    const viewport = document.querySelector('.fo-viewport')?.getBoundingClientRect();
    return freeSpot(cards, {
      x: ((viewport?.width || 1000) / 2 - camera.x) / camera.zoom - CARD_CENTER.x,
      y:
        (Math.max(160, (viewport?.height || 600) / 2 - 80) - camera.y) / camera.zoom -
        CARD_CENTER.y,
    });
  }
  async function storeMedia(
    src: string,
    signal: AbortSignal,
  ): Promise<{ media: Partial<Card>; warning?: string }> {
    const remote = src.startsWith('https://');
    const desktop = desktopBridge();
    if (remote && !desktop) return { media: { src, remoteTemporary: true } };
    if (!remote && !/^(data:(image|video)\/|blob:)/i.test(src))
      throw new Error('接口未返回可用的图片或视频');
    try {
      const response = await (remote
        ? fetch(src, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
        : fetch(src));
      if (remote && !response.ok) throw new Error('无法下载生成素材');
      const blob = await response.blob();
      if (!/^(image|video)\//.test(blob.type)) throw new Error('生成结果不是图片或视频');
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      try {
        const mediaId = await putMedia(blob);
        if (src.startsWith('blob:')) URL.revokeObjectURL(src);
        return { media: { src: url, mediaId, mimeType: blob.type } };
      } catch (error) {
        if (remote) {
          URL.revokeObjectURL(url);
          urls.current.delete(url);
          throw error;
        }
        const warning =
          error instanceof DesktopMediaTooLargeError
            ? `${error.message}，请下载并压缩素材`
            : desktop
              ? '结果已显示，但未能保存到本机，请及时下载'
              : '结果已显示，但浏览器存储不可用，请及时下载';
        return { media: { src: url, sessionOnly: true, mimeType: blob.type }, warning };
      }
    } catch (error) {
      if (!remote || signal.aborted) throw error;
      const warning =
        error instanceof DesktopMediaTooLargeError
          ? `${error.message}，请下载并压缩素材`
          : '临时链接可能过期，请及时下载';
      return { media: { src, remoteTemporary: true }, warning };
    }
  }
  function referenceData(card: Card, signal: AbortSignal): Promise<string> {
    const key = `${card.id}\n${card.src}`;
    let value = encoded.current.get(key);
    if (!value) {
      value = encodeReference(card, signal);
      encoded.current.set(key, value);
      value.catch(() => {
        if (encoded.current.get(key) === value) encoded.current.delete(key);
      });
    }
    return value;
  }
  async function reference(
    source: Card | undefined,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    if (!source) return;
    if (source.missingMedia || source.kind !== 'image') throw new Error('首帧必须是可读取的图片');
    if (source.src.startsWith('https://')) return source.src;
    const response = await fetch(source.src, { signal, credentials: 'omit' });
    if (!response.ok) throw new Error('无法读取首帧图片');
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || blob.size > 10 * 1024 * 1024)
      throw new Error('首帧需为不超过 10 MB 的图片');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const abort = () => reader.abort();
      const cleanup = () => signal.removeEventListener('abort', abort);
      reader.onload = () => {
        cleanup();
        resolve(String(reader.result));
      };
      reader.onerror = () => {
        cleanup();
        reject(new Error('首帧读取失败'));
      };
      reader.onabort = () => {
        cleanup();
        reject(new DOMException('已停止等待', 'AbortError'));
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        cleanup();
        reject(new DOMException('已停止等待', 'AbortError'));
        return;
      }
      reader.readAsDataURL(blob);
    });
  }
  async function poll(id: string, client: VideoClient, task: ActiveTask, first?: VideoResult) {
    const started = Date.now();
    let result = first;
    while (current(task)) {
      const card = getProject().cards.find(c => c.id === id);
      if (!card?.job?.id) return;
      if (!result)
        result = await client.getVideo({ id: card.job.id, signal: task.controller.signal });
      if (!current(task)) return;
      if (result.status === 'succeeded') {
        const src = result.src ?? (result.data && URL.createObjectURL(result.data));
        if (!src) {
          result = undefined;
          continue;
        }
        const { media, warning } = await storeMedia(src, task.controller.signal);
        if (!current(task)) return;
        update(draft => {
          const target = draft.cards.find(c => c.id === id);
          if (target?.job) {
            Object.assign(target, media, {
              kind: 'video',
              label: 'AI 生成视频',
              duration: target.job.config.duration,
              generatedAt: new Date().toISOString(),
            });
            target.job.status = 'succeeded';
            delete target.job.error;
          }
        }, false);
        toast(warning ?? '视频已加入画布 · 双击播放');
        notify('succeeded', '视频已加入画布');
        return;
      }
      if (result.status === 'failed') {
        const message = redact(result.error || '供应商返回生成失败', config.key);
        patchJob(id, { status: 'failed', error: message });
        throw new Error(message);
      }
      patchJob(id, { status: result.status, progress: result.progress, error: '' });
      if (Date.now() - started > 15 * 60 * 1000) {
        patchJob(id, { status: 'paused', error: '等待较久，可稍后继续查询同一任务' });
        return;
      }
      await wait(Date.now() - started > 60000 ? 7000 : 3000, task.controller.signal);
      result = undefined;
    }
  }
  async function generate(source?: Card, request?: GenerationRequest): Promise<void> {
    if (taskRef.current) return;
    const generationConfig = request?.config ?? config;
    const text = (request?.prompt ?? prompt).trim();
    if (!text) {
      toast(source ? '先写下运镜或动作描述，再生成视频' : '先写下一点想法，再开始生成');
      return;
    }
    const video = Boolean(source) || (request?.mode ?? mode) === 'video';
    if (!generationConfig.key) {
      needSettings('先连接一个生成服务。提示词已保留，保存后再点生成即可。');
      return;
    }
    if (video && !PROVIDER_CAPABILITIES[generationConfig.provider].video) {
      needSettings('生成视频需要火山方舟或支持视频的兼容服务，请切换供应商。');
      return;
    }
    if (video) askNotificationPermission();
    const task = start();
    if (!task) return;
    // Set once the submission is handed to the client, so earlier failures are known not to be sent.
    let sent = false;
    try {
      const client = createClient(generationConfig);
      // Shot consistency: shared notes go with every prompt; reference images with images where supported.
      const project = getProject();
      const prompted = withNotes(text, project.consistency?.notes);
      if (!video) {
        const sources = !supportsReferences(generationConfig.provider)
          ? []
          : request?.references
            ? request.references.filter(card => card.kind === 'image' && !card.missingMedia)
            : referenceCards(project);
        const references = sources.length
          ? await Promise.all(sources.map(card => referenceData(card, task.controller.signal)))
          : [];
        if (!current(task)) return;
        if (engine) {
          const label = sources.length ? `AI 生成图片 · 参考 ${sources.length}` : 'AI 生成图片';
          const outcome = await engine.run(
            {
              text,
              prompt: withReferenceRoles(prompted, sources),
              references,
              config: generationConfig,
              at: request?.position ?? position(request?.near),
              label,
              referenceIds: sources.map(card => card.id),
              textIds: request?.textIds,
              replace: request?.replace,
              onCard: request?.onCard,
            },
            task.controller.signal,
          );
          if (!current(task)) return;
          // A failure is already on the canvas as a failed card; only say so.
          const message = outcome.ok ? '图片已加入画布' : outcome.message;
          toast(message);
          notify(outcome.ok ? 'succeeded' : 'failed', message);
          return;
        }
        const result = await client.generateImage({
          prompt: withReferenceRoles(prompted, sources),
          references,
          signal: task.controller.signal,
        });
        if (!current(task)) return;
        const { media, warning } = await storeMedia(result.src, task.controller.signal);
        if (!current(task)) return;
        const card: Card = {
          id: uid(),
          ...(request?.position ?? position(request?.near)),
          ...media,
          src: media.src!,
          name: text.slice(0, 18),
          prompt: text,
          kind: 'image',
          provider: result.provider,
          model: result.model,
          size: generationConfig.imageSize,
          label: sources.length ? `AI 生成图片 · 参考 ${sources.length}` : 'AI 生成图片',
          ...(sources.length ? { referenceIds: sources.map(source => source.id) } : {}),
          ...(request?.textIds?.length ? { textIds: request.textIds } : {}),
          generatedAt: new Date().toISOString(),
        };
        update(draft => placeImageCard(draft, card, request?.replace));
        request?.onCard?.(card.id);
        toast(warning ?? '图片已加入画布');
        notify('succeeded', '图片已加入画布');
        return;
      }
      const firstFrame = await reference(source, task.controller.signal);
      if (!current(task)) return;
      if (engine) {
        const outcome = await engine.runVideo(
          {
            text,
            prompt: prompted,
            reference: firstFrame,
            source,
            config: generationConfig,
            at: request?.position ?? position(request?.near ?? source),
            onCard: request?.onCard,
          },
          task.controller.signal,
        );
        if (!current(task)) return;
        const message = outcome.ok ? '视频已加入画布 · 双击播放' : outcome.message;
        toast(message);
        notify(outcome.ok ? 'succeeded' : 'failed', message);
        return;
      }
      const id = uid();
      task.cardId = id;
      const card: Card = {
        id,
        ...(request?.position ?? position(request?.near ?? source)),
        name: text.slice(0, 18) + ' · 视频',
        prompt: text,
        sourceId: source?.id ?? '',
        src: source?.src || PENDING_MEDIA,
        kind: 'image',
        provider: generationConfig.provider,
        label: '视频任务',
        job: {
          id: '',
          status: 'submitting',
          provider: generationConfig.provider,
          prompt: text,
          config: preferenceOnly(generationConfig),
        },
      };
      update(draft => {
        draft.cards.push(card);
        draft.selected = id;
      });
      request?.onCard?.(id);
      sent = true;
      const result = await client.submitVideo({
        prompt: prompted,
        reference: firstFrame,
        signal: task.controller.signal,
      });
      if (mounted.current)
        patchJob(id, { id: result.id, status: current(task) ? result.status : 'paused' });
      if (!current(task)) return;
      await poll(id, client, task, result);
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : error, generationConfig.key);
      if (mounted.current && ownsTask(task) && task.cardId) {
        const card = getProject().cards.find(c => c.id === task.cardId);
        if (card?.job && !['failed', 'succeeded'].includes(card.job.status)) {
          // Only an unclear submission (network error, timeout) may have reached the provider;
          // a refusal or a local check leaves nothing to query, so the card says so plainly.
          const aborted = task.controller.signal.aborted;
          const outcome =
            aborted || card.job.id ? 'unknown' : sent ? submitFailure(error) : 'not-sent';
          patchJob(task.cardId, {
            status:
              outcome === 'rejected' ? 'rejected' : outcome === 'not-sent' ? 'failed' : 'paused',
            error: aborted ? '已停止本页等待' : message,
          });
        }
      }
      // A failed image leaves a card with its prompt and reason, instead of only a passing toast.
      if (!video && current(task)) {
        const at = request?.position ?? position(request?.near);
        const failed = failedImageCard(text, message, generationConfig, at);
        update(draft => placeImageCard(draft, failed, request?.replace));
        request?.onCard?.(failed.id);
      }
      if (!task.controller.signal.aborted && mounted.current) {
        toast(message);
        notify('failed', message);
      }
    } finally {
      finish(task);
    }
  }
  async function resume(card: Card) {
    if (taskRef.current || !card.job) return;
    if (!card.job.id && ['failed', 'rejected'].includes(card.job.status)) {
      toast('这次提交没有成功，没有可查询的任务');
      return;
    }
    if (!card.job.id) {
      toast('没有取得任务号，请先在供应商后台核对，避免重复提交');
      return;
    }
    if (!config.key) {
      needSettings('补填该供应商的密钥后，再继续查询原任务。');
      return;
    }
    const previous = card.job.config;
    if (
      config.provider !== previous.provider ||
      config.baseUrl.replace(/\/+$/, '') !== previous.baseUrl.replace(/\/+$/, '')
    ) {
      toast('请切回此任务原来的供应商和 API 地址');
      return;
    }
    const task = start();
    if (!task) return;
    task.cardId = card.id;
    try {
      await poll(card.id, createClient({ ...previous, key: config.key }), task);
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : error, config.key);
      if (mounted.current && ownsTask(task)) {
        const latest = getProject().cards.find(c => c.id === card.id);
        if (latest?.job && !['failed', 'succeeded'].includes(latest.job.status))
          patchJob(card.id, { status: 'paused', error: message });
        if (!task.controller.signal.aborted) {
          toast(message);
          notify('failed', message);
        }
      }
    } finally {
      finish(task);
    }
  }
  /** "再来一张": a new paid request with the card's prompt; never runs on its own. */
  function regenerate(card: Card): Promise<void> {
    const plan = regeneration(card, getProject().cards);
    if (!plan) return Promise.resolve();
    if (!plan.ok) {
      toast(plan.reason);
      return Promise.resolve();
    }
    const replace = plan.replaces ? card.id : undefined;
    return generate(plan.source, { prompt: plan.prompt, mode: plan.mode, near: card, replace });
  }
  async function download(card: Card) {
    if (card.missingMedia || (card.job && card.job.status !== 'succeeded')) return;
    const desktop = desktopBridge();
    if (card.remoteTemporary && desktop) {
      try {
        await desktop.openTemporaryDownload(card.src);
      } catch {
        toast('无法在浏览器打开临时素材链接');
      }
      return;
    }
    const link = document.createElement('a');
    link.href = card.src;
    link.download = `frameout-${card.id}.${card.kind === 'video' ? 'mp4' : card.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`;
    if (card.remoteTemporary) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    link.click();
  }
  return {
    mode,
    setMode,
    prompt,
    setPrompt,
    active,
    config,
    setConfig,
    generate,
    stop,
    resume,
    regenerate,
    download,
  };
}
