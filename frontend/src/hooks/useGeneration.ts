import { useCallback, useEffect, useRef, useState } from 'react';
import type { AIConfig, Card, GenerationMode, ProjectState, UpdateProject, VideoJob } from '../types';
import { createClient } from '../lib/ai-client';
import { PENDING_MEDIA, preferenceOnly, uid } from '../lib/project';
import { DesktopMediaTooLargeError, putMedia } from '../lib/media-store';
import { GENERATION_MODE_KEY, readStoredValue, writeStoredValue } from '../lib/desktop-storage';
import { initialConfig, redact, saveProfile } from '../lib/preferences';

// openSettings shows the API settings with a reason; without it, missing settings fall back to a toast.
type Options = { getProject: () => ProjectState; update: UpdateProject; toast: (message: string) => void; openSettings?: (notice: string) => void };
type ActiveTask = { controller: AbortController; cardId?: string };
type VideoResult = { id: string; status: string; src?: string; error?: string; progress?: number };
type VideoClient = { getVideo: (options: { id: string; signal: AbortSignal }) => Promise<VideoResult> };
export type GenerationRequest = { prompt: string; mode: GenerationMode; config?: AIConfig; position?: { x: number; y: number }; onCard?: (id: string) => void };
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('已停止等待', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('已停止等待', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
function initialMode(): GenerationMode { try { return readStoredValue(GENERATION_MODE_KEY) === 'video' ? 'video' : 'image'; } catch { return 'image'; } }

export function useGeneration({ getProject, update, toast, openSettings }: Options) {
  const [mode, setModeState] = useState<GenerationMode>(initialMode), [prompt, setPrompt] = useState('');
  const [config, setConfigState] = useState<AIConfig>(initialConfig), [active, setActive] = useState(false);
  const taskRef = useRef<ActiveTask | null>(null), mounted = useRef(true), urls = useRef(new Set<string>());
  const latest = useRef({ getProject, update, toast, openSettings }); latest.current = { getProject, update, toast, openSettings };
  const needSettings = (notice: string) => { if (latest.current.openSettings) latest.current.openSettings(notice); else toast(notice); };
  function patchJob(id: string, patch: Partial<VideoJob>) {
    latest.current.update(draft => { const card = draft.cards.find(c => c.id === id); if (card?.job) Object.assign(card.job, patch); }, false);
  }
  const stop = useCallback(() => {
    const task = taskRef.current; if (!task) return;
    task.controller.abort(); taskRef.current = null; setActive(false);
    if (task.cardId) latest.current.update(draft => { const job = draft.cards.find(c => c.id === task.cardId)?.job; if (job && job.status !== 'succeeded' && job.status !== 'failed') { job.status = 'paused'; job.error = job.id ? '已停止本页等待，可继续查询同一任务' : '未取得任务号，请先到供应商后台核对'; } }, false);
    latest.current.toast('已停止本页等待；已提交请求仍可能在供应商执行或计费');
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; taskRef.current?.controller.abort(); taskRef.current = null; urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear(); };
  }, []);
  function current(task: ActiveTask) { return mounted.current && taskRef.current === task && !task.controller.signal.aborted; }
  function ownsTask(task: ActiveTask): boolean { return taskRef.current === task; }
  function start(): ActiveTask | null { if (taskRef.current) return null; const task = { controller: new AbortController() }; taskRef.current = task; setActive(true); return task; }
  function finish(task: ActiveTask) { if (taskRef.current === task) { taskRef.current = null; if (mounted.current) setActive(false); } }
  const setConfig = useCallback((value: AIConfig) => { if (taskRef.current) stop(); setConfigState(value); saveProfile(value); }, [stop]);
  const setMode = useCallback((value: GenerationMode) => { setModeState(value); try { void writeStoredValue(GENERATION_MODE_KEY, value)?.catch(() => {}); } catch { /* Optional preference. */ } }, []);
  function position(source?: Card) {
    if (source) return { x: source.x + 300, y: source.y + 30 };
    const camera = getProject().camera;
    const viewport = document.querySelector('.fo-viewport')?.getBoundingClientRect();
    return { x: ((viewport?.width || 1000) / 2 - camera.x) / camera.zoom - 135, y: (Math.max(160, (viewport?.height || 600) / 2 - 80) - camera.y) / camera.zoom - 110 };
  }
  async function storeMedia(src: string, signal: AbortSignal): Promise<{ media: Partial<Card>; warning?: string }> {
    const remote = src.startsWith('https://');
    const desktop = window.frameoutDesktop;
    if (remote && !desktop) return { media: { src, remoteTemporary: true } };
    if (!remote && !/^(data:(image|video)\/|blob:)/i.test(src)) throw new Error('接口未返回可用的图片或视频');
    try {
      const response = await (remote ? fetch(src, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' }) : fetch(src));
      if (remote && !response.ok) throw new Error('无法下载生成素材');
      const blob = await response.blob();
      if (!/^(image|video)\//.test(blob.type)) throw new Error('生成结果不是图片或视频');
      const url = URL.createObjectURL(blob); urls.current.add(url);
      try {
        const mediaId = await putMedia(blob);
        if (src.startsWith('blob:')) URL.revokeObjectURL(src);
        return { media: { src: url, mediaId, mimeType: blob.type } };
      } catch (error) {
        if (remote) { URL.revokeObjectURL(url); urls.current.delete(url); throw error; }
        const warning = error instanceof DesktopMediaTooLargeError ? `${error.message}，请下载并压缩素材`
          : desktop ? '结果已显示，但未能保存到本机，请及时下载' : '结果已显示，但浏览器存储不可用，请及时下载';
        return { media: { src: url, sessionOnly: true, mimeType: blob.type }, warning };
      }
    } catch (error) {
      if (!remote || signal.aborted) throw error;
      const warning = error instanceof DesktopMediaTooLargeError ? `${error.message}，请下载并压缩素材` : '临时链接可能过期，请及时下载';
      return { media: { src, remoteTemporary: true }, warning };
    }
  }
  async function reference(source: Card | undefined, signal: AbortSignal): Promise<string | undefined> {
    if (!source) return;
    if (source.missingMedia || source.kind !== 'image') throw new Error('首帧必须是可读取的图片');
    if (source.src.startsWith('https://')) return source.src;
    const response = await fetch(source.src, { signal, credentials: 'omit' });
    if (!response.ok) throw new Error('无法读取首帧图片');
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || blob.size > 10 * 1024 * 1024) throw new Error('首帧需为不超过 10 MB 的图片');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const abort = () => reader.abort();
      const cleanup = () => signal.removeEventListener('abort', abort);
      reader.onload = () => { cleanup(); resolve(String(reader.result)); };
      reader.onerror = () => { cleanup(); reject(new Error('首帧读取失败')); };
      reader.onabort = () => { cleanup(); reject(new DOMException('已停止等待', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { cleanup(); reject(new DOMException('已停止等待', 'AbortError')); return; }
      reader.readAsDataURL(blob);
    });
  }
  async function poll(id: string, client: VideoClient, task: ActiveTask, first?: VideoResult) {
    const started = Date.now(); let result = first;
    while (current(task)) {
      const card = getProject().cards.find(c => c.id === id); if (!card?.job?.id) return;
      if (!result) result = await client.getVideo({ id: card.job.id, signal: task.controller.signal });
      if (!current(task)) return;
      if (result.status === 'succeeded') {
        if (!result.src) { result = undefined; continue; }
        const { media, warning } = await storeMedia(result.src, task.controller.signal); if (!current(task)) return;
        update(draft => { const target = draft.cards.find(c => c.id === id); if (target?.job) { Object.assign(target, media, { kind: 'video', label: 'AI 生成视频', duration: target.job.config.duration, generatedAt: new Date().toISOString() }); target.job.status = 'succeeded'; delete target.job.error; } }, false);
        toast(warning ?? '视频已加入画布 · 双击播放'); return;
      }
      if (result.status === 'failed') { const message = redact(result.error || '供应商返回生成失败', config.key); patchJob(id, { status: 'failed', error: message }); throw new Error(message); }
      patchJob(id, { status: result.status, progress: result.progress, error: '' });
      if (Date.now() - started > 15 * 60 * 1000) { patchJob(id, { status: 'paused', error: '等待较久，可稍后继续查询同一任务' }); return; }
      await wait(Date.now() - started > 60000 ? 7000 : 3000, task.controller.signal); result = undefined;
    }
  }
  async function generate(source?: Card, request?: GenerationRequest): Promise<void> {
    if (taskRef.current) return;
    const generationConfig = request?.config ?? config;
    const text = (request?.prompt ?? prompt).trim();
    if (!text) { toast(source ? '先写下运镜或动作描述，再生成视频' : '先写下一点想法，再开始生成'); return; }
    const video = Boolean(source) || (request?.mode ?? mode) === 'video';
    if (!generationConfig.key) { needSettings('先连接一个生成服务。提示词已保留，保存后再点生成即可。'); return; }
    if (video && generationConfig.provider === 'openai') { needSettings('生成视频需要火山方舟或支持视频的兼容服务，请切换供应商。'); return; }
    const task = start(); if (!task) return;
    try {
      const client = createClient(generationConfig);
      if (!video) {
        const result = await client.generateImage({ prompt: text, signal: task.controller.signal }); if (!current(task)) return;
        const { media, warning } = await storeMedia(result.src, task.controller.signal); if (!current(task)) return;
        const card: Card = { id: uid(), ...(request?.position ?? position()), ...media, src: media.src!, name: text.slice(0, 18), prompt: text, kind: 'image', provider: result.provider, model: result.model, size: generationConfig.imageSize, label: 'AI 生成图片', generatedAt: new Date().toISOString() };
        update(draft => { draft.cards.push(card); draft.selected = card.id; }); request?.onCard?.(card.id); setPrompt(''); toast(warning ?? '图片已加入画布'); return;
      }
      const firstFrame = await reference(source, task.controller.signal); if (!current(task)) return;
      const id = uid(); task.cardId = id;
      const card: Card = { id, ...position(source), name: text.slice(0, 18) + ' · 视频', prompt: text, src: source?.src || PENDING_MEDIA, kind: 'image', provider: generationConfig.provider, label: '视频任务', job: { id: '', status: 'submitting', provider: generationConfig.provider, prompt: text, config: preferenceOnly(generationConfig) } };
      update(draft => { draft.cards.push(card); draft.selected = id; });
      request?.onCard?.(id);
      const result = await client.submitVideo({ prompt: text, reference: firstFrame, signal: task.controller.signal });
      if (mounted.current) patchJob(id, { id: result.id, status: current(task) ? result.status : 'paused' });
      if (!current(task)) return;
      setPrompt(''); await poll(id, client, task, result);
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : error, generationConfig.key);
      if (mounted.current && ownsTask(task) && task.cardId) {
        const card = getProject().cards.find(c => c.id === task.cardId);
        if (card?.job && !['failed', 'succeeded'].includes(card.job.status)) patchJob(task.cardId, { status: 'paused', error: task.controller.signal.aborted ? '已停止本页等待' : message });
      }
      if (!task.controller.signal.aborted && mounted.current) toast(message);
    } finally { finish(task); }
  }
  async function resume(card: Card) {
    if (taskRef.current || !card.job) return;
    if (!card.job.id) { toast('没有取得任务号，请先在供应商后台核对，避免重复提交'); return; }
    if (!config.key) { needSettings('补填该供应商的密钥后，再继续查询原任务。'); return; }
    const previous = card.job.config;
    if (config.provider !== previous.provider || config.baseUrl.replace(/\/+$/, '') !== previous.baseUrl.replace(/\/+$/, '')) { toast('请切回此任务原来的供应商和 API 地址'); return; }
    const task = start(); if (!task) return; task.cardId = card.id;
    try { await poll(card.id, createClient({ ...previous, key: config.key }), task); }
    catch (error) {
      const message = redact(error instanceof Error ? error.message : error, config.key);
      if (mounted.current && ownsTask(task)) { const latest = getProject().cards.find(c => c.id === card.id); if (latest?.job && !['failed', 'succeeded'].includes(latest.job.status)) patchJob(card.id, { status: 'paused', error: message }); if (!task.controller.signal.aborted) toast(message); }
    } finally { finish(task); }
  }
  async function download(card: Card) {
    if (card.missingMedia || (card.job && card.job.status !== 'succeeded')) return;
    const desktop = window.frameoutDesktop;
    if (card.remoteTemporary && desktop) {
      try { await desktop.openTemporaryDownload(card.src); }
      catch { toast('无法在浏览器打开临时素材链接'); }
      return;
    }
    const link = document.createElement('a'); link.href = card.src;
    link.download = `frameout-${card.id}.${card.kind === 'video' ? 'mp4' : card.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`;
    if (card.remoteTemporary) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    link.click();
  }
  return { mode, setMode, prompt, setPrompt, active, config, setConfig, generate, stop, resume, download };
}
