import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGeneration } from './useGeneration';
import { AIError, createClient } from '@frameout/shared';
import { putMedia } from '../lib/media-store';
import { initialState, preferenceOnly } from '../lib/project';
import { defaults } from '../lib/preferences';
import type { AIConfig, Card, ProjectState, UpdateProject } from '../types';

vi.mock('@frameout/shared', async importOriginal => ({
  ...(await importOriginal<typeof import('@frameout/shared')>()),
  createClient: vi.fn(),
}));
vi.mock('../lib/media-store', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/media-store')>()),
  putMedia: vi.fn(),
}));

const client = { generateImage: vi.fn(), submitVideo: vi.fn(), getVideo: vi.fn() };
const config: AIConfig = { ...defaults('ark'), key: 'fixture-key', videoModel: 'video-model' };
const PROMPT = '海边的灯塔，黄昏，镜头缓缓推进，远处有一艘返航的渔船';
const frame: Card = {
  id: 'frame',
  x: 0,
  y: 0,
  name: '灯塔',
  kind: 'image',
  src: 'https://media.example/frame.png',
  provider: 'ark',
  prompt: '海边的灯塔',
};

function harness(cards: Card[] = []) {
  let project: ProjectState = { ...initialState(), cards };
  const update = vi.fn<UpdateProject>(recipe => {
    const next = structuredClone(project);
    recipe(next);
    project = next;
  });
  const toast = vi.fn();
  const hook = renderHook(() => useGeneration({ getProject: () => project, update, toast }));
  act(() => {
    hook.result.current.setConfig({ ...config });
    hook.result.current.setPrompt(PROMPT);
  });
  return { ...hook, getProject: () => project, toast };
}
const videoCard = (h: ReturnType<typeof harness>) => h.getProject().cards.find(c => c.job)!;

beforeEach(() => {
  localStorage.clear();
  document.title = '创作画布';
  for (const mock of Object.values(client)) mock.mockReset();
  vi.mocked(createClient)
    .mockReset()
    .mockReturnValue(client as never);
  vi.mocked(putMedia).mockReset().mockResolvedValue('media-1');
  client.generateImage.mockResolvedValue({
    src: 'data:image/png;base64,aA==',
    provider: 'ark',
    model: 'image-model',
  });
  const NativeURL = URL;
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:generated-result');
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('keeping the prompt', () => {
  it('leaves the prompt in the composer and stores it in full on the card', async () => {
    const h = harness();
    await act(() => h.result.current.generate());
    expect(h.result.current.prompt).toBe(PROMPT);
    expect(h.getProject().cards[0].prompt).toBe(PROMPT);
  });

  it('keeps the prompt after a video is submitted and records text-to-video', async () => {
    client.submitVideo.mockResolvedValue({ id: 'task-1', status: 'queued' });
    client.getVideo.mockReturnValue(new Promise(() => {}));
    const h = harness();
    act(() => h.result.current.setMode('video'));
    await act(async () => {
      void h.result.current.generate();
    });
    expect(h.result.current.prompt).toBe(PROMPT);
    expect(videoCard(h)).toMatchObject({ prompt: PROMPT, sourceId: '' });
    act(() => h.result.current.stop());
  });
});

describe('video submissions that fail', () => {
  async function submitVideo(error: unknown, h = harness()) {
    client.submitVideo.mockRejectedValue(error);
    act(() => h.result.current.setMode('video'));
    await act(() => h.result.current.generate());
    return h;
  }

  it('marks a definite provider refusal as rejected and does not offer to query it', async () => {
    const h = await submitVideo(
      new AIError('请求参数不被模型接受：duration', { code: 'UPSTREAM_ERROR', status: 400 }),
    );
    expect(videoCard(h).job).toMatchObject({
      id: '',
      status: 'rejected',
      error: '请求参数不被模型接受：duration',
    });
    h.toast.mockClear();
    await act(() => h.result.current.resume(videoCard(h)));
    expect(h.toast).toHaveBeenCalledWith(expect.not.stringContaining('后台'));
    expect(client.submitVideo).toHaveBeenCalledTimes(1);
    expect(client.getVideo).not.toHaveBeenCalled();
  });

  it('marks a safety rejection as rejected with the plain message', async () => {
    const message = '内容被供应商的安全审核拒绝，请调整描述或参考图后再试';
    const h = await submitVideo(new AIError(message, { code: 'CONTENT_REJECTED', status: 400 }));
    expect(videoCard(h).job).toMatchObject({ status: 'rejected', error: message });
    expect(h.toast).toHaveBeenCalledWith(message);
  });

  it('keeps the provider-backend check only for unclear failures', async () => {
    const h = await submitVideo(
      new AIError('请求超时。供应商可能仍在执行', { code: 'TIMEOUT', status: 0 }),
    );
    expect(videoCard(h).job).toMatchObject({ id: '', status: 'paused' });
    h.toast.mockClear();
    await act(() => h.result.current.resume(videoCard(h)));
    expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('供应商后台核对'));
  });

  it('marks a 5xx reply as unclear too', async () => {
    const h = await submitVideo(
      new AIError('供应商暂时不可用', { code: 'UPSTREAM_ERROR', status: 502 }),
    );
    expect(videoCard(h).job?.status).toBe('paused');
  });

  it('adds no task card when the first frame cannot be read', async () => {
    const missing: Card = { ...frame, src: 'blob:gone' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    const h = harness([missing]);
    await act(() => h.result.current.generate(missing));
    expect(client.submitVideo).not.toHaveBeenCalled();
    expect(h.getProject().cards).toEqual([missing]);
    expect(h.toast).toHaveBeenCalledWith('无法读取首帧图片');
  });

  it('marks a request the client refused to send as failed', async () => {
    const h = await submitVideo(
      new AIError('首帧需为公开 HTTPS 图片或 Base64 图片', { code: 'CONFIG_REFERENCE' }),
    );
    expect(videoCard(h).job).toMatchObject({ id: '', status: 'failed' });
  });
});

describe('再来一张', () => {
  it('re-runs an image with its own prompt without touching the composer', async () => {
    const h = harness([frame]);
    act(() => h.result.current.setPrompt('另一个想法'));
    await act(() => h.result.current.regenerate(frame));
    expect(client.generateImage).toHaveBeenCalledTimes(1);
    expect(client.generateImage.mock.calls[0][0].prompt).toBe('海边的灯塔');
    expect(h.result.current.prompt).toBe('另一个想法');
    expect(h.getProject().cards[1]).toMatchObject({ prompt: '海边的灯塔', x: 300, y: 30 });
  });

  it('re-runs image-to-video with the same first frame', async () => {
    client.submitVideo.mockRejectedValue(
      new AIError('拒绝', { code: 'UPSTREAM_ERROR', status: 400 }),
    );
    const video: Card = {
      ...frame,
      id: 'old-video',
      x: 300,
      kind: 'video',
      prompt: '镜头推进',
      sourceId: 'frame',
      job: {
        id: 'task-0',
        provider: 'ark',
        status: 'succeeded',
        prompt: '镜头推进',
        config: preferenceOnly(config),
      },
    };
    const h = harness([frame, video]);
    await act(() => h.result.current.regenerate(video));
    expect(client.submitVideo).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '镜头推进', reference: frame.src }),
    );
    expect(h.getProject().cards[2]).toMatchObject({ sourceId: 'frame', x: 600 });
  });

  it('explains instead of running when the first frame is gone', async () => {
    const video: Card = {
      ...frame,
      id: 'old-video',
      kind: 'video',
      sourceId: 'deleted',
      job: {
        id: 't',
        provider: 'ark',
        status: 'succeeded',
        prompt: 'p',
        config: preferenceOnly(config),
      },
    };
    const h = harness([video]);
    await act(() => h.result.current.regenerate(video));
    expect(client.submitVideo).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('首帧'));
  });
});

describe('completion notice', () => {
  it('changes the title when a generation finishes while the page is hidden', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const h = harness();
    await act(() => h.result.current.generate());
    expect(document.title).toBe('✓ 生成完成 · 帧外');
  });

  it('asks for notification permission when a video starts, not on load', async () => {
    const requestPermission = vi.fn(async () => 'default');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    const h = harness();
    expect(requestPermission).not.toHaveBeenCalled();
    await act(() => h.result.current.generate());
    expect(requestPermission).not.toHaveBeenCalled();
    client.submitVideo.mockRejectedValue(
      new AIError('拒绝', { code: 'UPSTREAM_ERROR', status: 400 }),
    );
    act(() => h.result.current.setMode('video'));
    await act(() => h.result.current.generate());
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });
});
