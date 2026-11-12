// Pure provider adapters; request credentials are never persisted.
import {
  OFFICIAL_BASE_URLS,
  PROVIDER_CAPABILITIES,
  PROVIDER_KEY_PAGES,
  RELAY_PATH,
  type RelayEnvelope,
} from '@frameout/shared';
import type { AIConfig, Provider } from '../types';

type ProviderPreset = {
  label: string;
  baseUrl: string;
  defaultImageModel: string;
  defaultVideoModel: string;
  imageSizes: readonly string[];
  videoDurations: readonly string[];
  canVideo: boolean;
  note: string;
  /** Where a user creates an API key; empty for self-hosted services. */
  keyUrl: string;
};
type Transport = AIConfig['transport'];
type ClientOptions = { fetchImpl?: typeof fetch; proxyPath?: string; timeoutMs?: number };
type RequestOptions = { signal?: AbortSignal; raw?: boolean; timeout?: number };
// Untrusted provider JSON; every field is checked where it is read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProviderJson = any;
export type VideoStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type VideoResult = {
  id: string;
  status: VideoStatus;
  provider: Provider;
  model: string;
  src?: string;
  progress?: number;
  error?: string;
  requestId?: string;
};
export type ImageResult = {
  src: string;
  kind: 'image';
  provider: Provider;
  model: string;
  requestId?: string;
};

const PROVIDERS: Readonly<Record<Provider, Readonly<ProviderPreset>>> = Object.freeze({
  openai: Object.freeze({
    label: 'OpenAI',
    baseUrl: OFFICIAL_BASE_URLS.openai,
    defaultImageModel: 'gpt-image-1.5',
    defaultVideoModel: '',
    imageSizes: ['1536x1024', '1024x1024', '1024x1536'],
    videoDurations: [],
    canVideo: PROVIDER_CAPABILITIES.openai.video,
    note: '此配置用于图片生成；视频请使用火山方舟或支持视频协议的兼容服务。',
    keyUrl: PROVIDER_KEY_PAGES.openai,
  }),
  ark: Object.freeze({
    label: '火山方舟',
    baseUrl: OFFICIAL_BASE_URLS.ark,
    defaultImageModel: 'doubao-seedream-5-0-pro-260628',
    defaultVideoModel: 'doubao-seedance-2-5-260628',
    imageSizes: ['2K', '1.5K', '1K', '2816x1584', '1584x2816'],
    videoDurations: ['5', '8', '10', '12'],
    canVideo: PROVIDER_CAPABILITIES.ark.video,
    note: '模型需在方舟账号中开通；图生视频会保持首帧比例。',
    keyUrl: PROVIDER_KEY_PAGES.ark,
  }),
  compatible: Object.freeze({
    label: 'OpenAI 兼容接口',
    baseUrl: '',
    defaultImageModel: 'gpt-image-1.5',
    defaultVideoModel: '',
    imageSizes: ['1536x1024', '1024x1024', '1024x1536'],
    videoDurations: ['4', '8', '12'],
    canVideo: PROVIDER_CAPABILITIES.compatible.video,
    note: '浏览器直连；服务需支持跨域和所选图片／视频协议，模型名由服务商提供。',
    keyUrl: '',
  }),
});

class AIError extends Error {
  code: string;
  status: number;
  requestId?: string;
  constructor(
    message: string,
    {
      code = 'AI_ERROR',
      status = 0,
      requestId = '',
    }: { code?: string; status?: number; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'AIError';
    this.code = code;
    this.status = status;
    if (requestId) this.requestId = requestId;
  }
}

function publicHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    host.includes('.') &&
    !host.includes(':') &&
    !host.startsWith('[') &&
    !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) &&
    !/(^|\.)(?:localhost|local|internal|localdomain|lan|home|arpa)$/.test(host)
  );
}

function validateBaseUrl(value: unknown): string {
  let url: URL;
  try {
    url = new URL(String(value || '').trim());
  } catch (_) {
    throw new AIError('请输入完整的 HTTPS Base URL', { code: 'CONFIG_URL' });
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !publicHostname(url.hostname)
  ) {
    throw new AIError('Base URL 需使用公开 HTTPS 域名，不能包含账号、查询参数或私网地址', {
      code: 'CONFIG_URL',
    });
  }
  return url.href.replace(/\/+$/, '');
}

function abortError() {
  const error = new Error('已停止等待');
  error.name = 'AbortError';
  return error;
}

function required(value: unknown, label: string, limit = 1000): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > limit)
    throw new AIError(`请填写有效的${label}`, { code: 'CONFIG_VALUE' });
  return text;
}

function safeMediaUrl(value: unknown, imageOnly = false): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(text)) return text;
  if (!imageOnly && /^data:video\/(?:mp4|webm);base64,[A-Za-z0-9+/=\s]+$/.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch (_) {
    return '';
  }
  return url.protocol === 'https:' && !url.username && !url.password && publicHostname(url.hostname)
    ? url.href
    : '';
}

function createClient(config: Partial<AIConfig> = {}, options: ClientOptions = {}) {
  const provider: Provider = config.provider || 'openai';
  // Saved settings are untrusted, so the provider can still be unknown at run time.
  const found: Readonly<ProviderPreset> | undefined = PROVIDERS[provider];
  if (!found) throw new AIError('不支持的供应商', { code: 'CONFIG_PROVIDER' });
  const preset = found;
  const baseUrl = validateBaseUrl(config.baseUrl || preset.baseUrl);
  const transport: Transport = config.transport || (provider === 'compatible' ? 'direct' : 'proxy');
  if (transport !== 'direct' && transport !== 'proxy')
    throw new AIError('不支持的请求方式', { code: 'CONFIG_TRANSPORT' });
  if (transport === 'proxy' && (provider === 'compatible' || baseUrl !== preset.baseUrl)) {
    throw new AIError('后端转发仅支持 OpenAI 和火山方舟官方地址；自定义接口请使用浏览器直连', {
      code: 'CONFIG_TRANSPORT',
    });
  }
  const key = required(config.key, ' API Key', 2048);
  if (/\s|[\x00-\x1f\x7f]/.test(key))
    throw new AIError('API Key 不能包含空格或换行', { code: 'CONFIG_KEY' });
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function')
    throw new AIError('当前浏览器不支持网络请求', { code: 'UNSUPPORTED' });
  const proxyPath = options.proxyPath || RELAY_PATH;
  if (!/^\/(?!\/)[A-Za-z0-9/_-]+$/.test(proxyPath))
    throw new AIError('后端转发路径无效', { code: 'CONFIG_TRANSPORT' });
  const imageModel = config.imageModel || preset.defaultImageModel;
  const videoModel = config.videoModel || preset.defaultVideoModel;
  const imageSize = config.imageSize || preset.imageSizes[0];
  const videoRatio = config.videoRatio || '16:9';
  const duration = Number(config.duration || preset.videoDurations[0] || 5);
  const resolution = config.resolution || '720p';

  function redact(value: unknown): string {
    return String(value || '')
      .split(key)
      .join('[已隐藏]')
      .replace(/Bearer\s+[^\s,;"<>]+/gi, 'Bearer [已隐藏]')
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[已隐藏]')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
      .slice(0, 350);
  }

  function upstreamError(status: number, body: ProviderJson, requestId: string) {
    const detail =
      typeof body?.error === 'string' ? body.error : body?.error?.message || body?.message || '';
    const labels: Record<number, string> = {
      400: '请求参数不被模型接受',
      401: 'API Key 无效或已过期',
      403: '此 Key 没有调用权限',
      404: '接口或模型不存在',
      429: '请求频率或账户额度受限',
    };
    const message = labels[status] || (status >= 500 ? '供应商暂时不可用' : 'AI 请求失败');
    return new AIError(message + (detail ? '：' + redact(detail) : ''), {
      code: 'UPSTREAM_ERROR',
      status,
      requestId: redact(requestId),
    });
  }

  async function request(
    path: string,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown,
    { signal, raw = false, timeout = 30000 }: RequestOptions = {},
  ): Promise<{ json?: ProviderJson; blob?: Blob; requestId: string }> {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal) signal.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timeoutMs =
      options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : timeout;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const init: RequestInit = {
        signal: controller.signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      };
      let url: string;
      if (transport === 'proxy') {
        url = proxyPath;
        init.method = 'POST';
        init.headers = { 'Content-Type': 'application/json' };
        const envelope: RelayEnvelope = {
          provider,
          baseUrl,
          apiKey: key,
          path,
          method,
          ...(body === undefined ? {} : { body }),
        };
        init.body = JSON.stringify(envelope);
      } else {
        url = baseUrl + path;
        init.method = method;
        init.headers = {
          Authorization: 'Bearer ' + key,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        };
        if (body !== undefined) init.body = JSON.stringify(body);
      }
      const response = await fetchImpl(url, init);
      const requestId = redact(
        response.headers?.get('x-request-id') || response.headers?.get('x-tt-logid') || '',
      );
      if (raw && response.ok) return { blob: await response.blob(), requestId };
      let json: ProviderJson;
      try {
        json = await response.json();
      } catch (_) {
        if (!response.ok) throw upstreamError(response.status, {}, requestId);
        throw new AIError('供应商未返回有效的 JSON 数据', { code: 'INVALID_RESPONSE', requestId });
      }
      const failedTask = ['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(
        json?.status,
      );
      if (!response.ok || (json?.error && !failedTask))
        throw upstreamError(response.status, json, requestId);
      return { json, requestId };
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (timedOut)
        throw new AIError('请求超时。供应商可能仍在执行，请先检查供应商控制台，避免重复提交。', {
          code: 'TIMEOUT',
        });
      if (error instanceof AIError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw abortError();
      throw new AIError(
        transport === 'direct'
          ? '连接失败。请检查网络、Base URL 和服务的跨域配置。'
          : '后端转发连接失败，请稍后重试。',
        { code: 'NETWORK_ERROR' },
      );
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
    }
  }

  async function testConnection({ signal }: { signal?: AbortSignal } = {}) {
    const { json } = await request(
      provider === 'ark' ? '/contents/generations/tasks?page_size=1' : '/models',
      'GET',
      undefined,
      { signal },
    );
    const validList =
      provider === 'ark'
        ? Array.isArray(json?.items) || (json?.items === null && Number.isFinite(json?.total))
        : Array.isArray(json?.data);
    if (!validList)
      throw new AIError('连接返回的数据不符合供应商接口格式，请检查 Base URL', {
        code: 'INVALID_RESPONSE',
      });
    // Do not return the Ark task list: it may contain the visitor's private work.
    const models =
      provider === 'ark'
        ? undefined
        : Array.isArray(json?.data)
          ? json.data
              .map((item: ProviderJson) => redact(item?.id))
              .filter(Boolean)
              .slice(0, 200)
          : undefined;
    return {
      ok: true,
      message: '鉴权连接成功；所选模型的生成权限以实际请求为准。',
      ...(models ? { models } : {}),
    };
  }

  async function generateImage({
    prompt: text,
    references = [],
    signal,
  }: { prompt?: string; references?: string[]; signal?: AbortSignal } = {}): Promise<ImageResult> {
    const prompt = required(text, '图片提示词', 32000);
    const model = required(imageModel, '图片模型名', 200);
    const size = required(imageSize, '图片尺寸', 40);
    if (references.length > 10) throw new AIError('参考图最多 10 张', { code: 'CONFIG_REFERENCE' });
    if (references.some(value => !safeMediaUrl(value, true)))
      throw new AIError('参考图需为公开 HTTPS 图片或 Base64 图片', { code: 'CONFIG_REFERENCE' });
    if (references.length && provider === 'compatible')
      throw new AIError('参考图仅支持 OpenAI 与火山方舟官方接口', { code: 'CONFIG_REFERENCE' });
    let path = '/images/generations';
    let body: ProviderJson;
    if (provider === 'ark') {
      // Seedream takes references on the same endpoint. 5.0 pro/flash do not accept sequential_image_generation; omit it.
      body = {
        model,
        prompt,
        size,
        response_format: 'b64_json',
        watermark: false,
        ...(references.length
          ? { image: references.length === 1 ? references[0] : references }
          : {}),
      };
    } else if (references.length) {
      // GPT Image models take references through the JSON image edit endpoint.
      path = '/images/edits';
      body = {
        model,
        prompt,
        n: 1,
        size,
        images: references.map(image_url => ({ image_url })),
        ...(/^gpt-image-1\.5\b/.test(model) ? { input_fidelity: 'high' } : {}),
      };
    } else {
      body = { model, prompt, n: 1, size };
    }
    const { json, requestId } = await request(path, 'POST', body, { signal, timeout: 300000 });
    const image = Array.isArray(json?.data)
      ? json.data.find((item: ProviderJson) => item?.b64_json || item?.url)
      : null;
    if (!image)
      throw new AIError('生成请求未返回图片，请检查模型能力与响应格式', {
        code: 'INVALID_RESPONSE',
        requestId,
      });
    let src = safeMediaUrl(image.url, true);
    if (
      typeof image.b64_json === 'string' &&
      /^[A-Za-z0-9+/=\s]+$/.test(image.b64_json) &&
      image.b64_json.trim()
    ) {
      const b64 = image.b64_json.replace(/\s/g, '');
      let format: string =
        image.output_format || json.output_format || (provider === 'ark' ? 'jpeg' : 'png');
      if (b64.startsWith('iVBORw0KGgo')) format = 'png';
      else if (b64.startsWith('/9j/')) format = 'jpeg';
      else if (b64.startsWith('UklGR')) format = 'webp';
      if (!['png', 'jpeg', 'webp', 'gif'].includes(format)) format = 'png';
      src = `data:image/${format};base64,${b64}`;
    }
    if (!src)
      throw new AIError('供应商返回的图片地址或编码无效', { code: 'INVALID_RESPONSE', requestId });
    return { src, kind: 'image', provider, model, ...(requestId ? { requestId } : {}) };
  }

  function requireVideo() {
    if (!preset.canVideo || new URL(baseUrl).hostname.toLowerCase() === 'api.openai.com') {
      throw new AIError('此配置不提供 OpenAI 视频调用，请选择火山方舟或提供视频服务的兼容接口', {
        code: 'VIDEO_UNAVAILABLE',
      });
    }
    required(videoModel, '视频模型名', 200);
    if (!Number.isInteger(duration) || duration < 1 || duration > 30)
      throw new AIError('视频时长需为 1 到 30 秒之间的整数', { code: 'CONFIG_VALUE' });
    if (provider === 'compatible' && !['16:9', '9:16'].includes(videoRatio)) {
      throw new AIError('此兼容视频协议仅支持 16:9 或 9:16，请调整视频比例', {
        code: 'CONFIG_VALUE',
      });
    }
  }

  function normalizeVideo(value: ProviderJson, fallbackId: string, requestId: string): VideoResult {
    const json =
      value?.data && !Array.isArray(value.data) && typeof value.data === 'object'
        ? value.data
        : value;
    const id = String(json?.id || json?.task_id || fallbackId || '');
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(id))
      throw new AIError('供应商未返回有效的视频任务 ID', { code: 'INVALID_RESPONSE', requestId });
    const statusMap: Record<string, VideoStatus> = {
      queued: 'queued',
      pending: 'queued',
      submitted: 'queued',
      running: 'running',
      processing: 'running',
      in_progress: 'running',
      succeeded: 'succeeded',
      completed: 'succeeded',
      success: 'succeeded',
      failed: 'failed',
      error: 'failed',
      cancelled: 'failed',
      canceled: 'failed',
      expired: 'failed',
    };
    const rawStatus = json?.status || 'queued';
    const status = statusMap[rawStatus];
    if (!status)
      throw new AIError('供应商返回了未知的视频任务状态：' + redact(rawStatus), {
        code: 'INVALID_RESPONSE',
        requestId,
      });
    const src = safeMediaUrl(
      json?.content?.video_url || json?.output?.video_url || json?.video_url || json?.url || '',
    );
    const progress = Number(json?.progress);
    const error =
      status === 'failed'
        ? redact(
            typeof json.error === 'string'
              ? json.error
              : json?.error?.message || '视频任务未完成：' + rawStatus,
          )
        : '';
    return {
      id,
      status,
      provider,
      model: json?.model || videoModel,
      ...(src ? { src } : {}),
      ...(Number.isFinite(progress) ? { progress: Math.min(100, Math.max(0, progress)) } : {}),
      ...(error ? { error } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }

  async function submitVideo({
    prompt: text,
    reference,
    signal,
  }: { prompt?: string; reference?: string; signal?: AbortSignal } = {}): Promise<VideoResult> {
    requireVideo();
    const prompt = required(text, '视频提示词', 32000);
    if (reference && !safeMediaUrl(reference, true))
      throw new AIError('首帧需为公开 HTTPS 图片或 Base64 图片', { code: 'CONFIG_REFERENCE' });
    let body: ProviderJson;
    if (provider === 'ark') {
      body = {
        model: videoModel,
        content: [{ type: 'text', text: prompt }],
        duration,
        ratio: reference ? 'adaptive' : videoRatio,
        resolution,
        watermark: false,
      };
      if (reference)
        body.content.push({
          type: 'image_url',
          image_url: { url: reference },
          role: 'first_frame',
        });
    } else {
      const portrait = videoRatio === '9:16';
      const size =
        resolution === '1080p'
          ? portrait
            ? '1024x1792'
            : '1792x1024'
          : portrait
            ? '720x1280'
            : '1280x720';
      body = { model: videoModel, prompt, seconds: String(duration), size };
      if (reference) body.input_reference = { image_url: reference };
    }
    const { json, requestId } = await request(
      provider === 'ark' ? '/contents/generations/tasks' : '/videos',
      'POST',
      body,
      { signal, timeout: 90000 },
    );
    return normalizeVideo(json, '', requestId);
  }

  async function getVideo({
    id,
    signal,
  }: { id?: string; signal?: AbortSignal } = {}): Promise<VideoResult> {
    requireVideo();
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(id))
      throw new AIError('视频任务 ID 无效', { code: 'CONFIG_VALUE' });
    const path = provider === 'ark' ? '/contents/generations/tasks/' + id : '/videos/' + id;
    const { json, requestId } = await request(path, 'GET', undefined, { signal });
    const result = normalizeVideo(json, id, requestId);
    if (result.status === 'succeeded' && !result.src) {
      if (provider === 'ark')
        throw new AIError('已完成的视频任务没有返回视频地址', {
          code: 'INVALID_RESPONSE',
          requestId,
        });
      const { blob } = await request(path + '/content', 'GET', undefined, {
        signal,
        raw: true,
        timeout: 90000,
      });
      if (!blob || !blob.size || (blob.type && !/^video\//.test(blob.type)))
        throw new AIError('视频下载接口未返回有效的视频文件', {
          code: 'INVALID_RESPONSE',
          requestId,
        });
      result.src = URL.createObjectURL(blob);
    }
    return result;
  }

  return Object.freeze({ testConnection, generateImage, submitVideo, getVideo });
}

export { PROVIDERS, AIError, createClient, validateBaseUrl };
