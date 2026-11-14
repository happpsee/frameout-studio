import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGeneration } from './useGeneration';
import { createClient } from '@frameout/shared';
import { putMedia } from '../project/media-store';
import { initialState, preferenceOnly, serializeProject } from '../project/project';
import { defaults, PREFERENCES_KEY } from '../../shell/settings/preferences';
import type { AIConfig, Card, ProjectState, UpdateProject } from '../../types';

vi.mock('@frameout/shared', async importOriginal => ({
  ...(await importOriginal<typeof import('@frameout/shared')>()),
  createClient: vi.fn(),
}));
vi.mock('../project/media-store', async importOriginal => ({
  ...(await importOriginal<typeof import('../project/media-store')>()),
  putMedia: vi.fn(),
}));

vi.mock('./consistency', async importOriginal => ({
  ...(await importOriginal<typeof import('./consistency')>()),
  encodeReference: vi.fn(async (card: Card) => `data:image/jpeg;base64,${card.id}`),
}));
const client = { generateImage: vi.fn(), submitVideo: vi.fn(), getVideo: vi.fn() };
const KEY = 'fixture-only-secret-never-save';
const originalConfig: AIConfig = {
  ...defaults('ark'),
  key: KEY,
  imageModel: 'original-image-model',
  videoModel: 'original-video-model',
  duration: 8,
  videoRatio: '4:3',
  resolution: '1080p',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function jobCard(id = 'provider-job-123'): Card {
  return {
    id: 'video-card',
    x: 10,
    y: 20,
    name: '待完成镜头',
    src: '/assets/forest-astronaut.png',
    kind: 'image',
    job: {
      id,
      provider: 'ark',
      prompt: '沿着森林缓缓推进',
      status: 'paused',
      config: preferenceOnly(originalConfig),
    },
  };
}

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
    hook.result.current.setConfig({ ...originalConfig });
    hook.result.current.setPrompt('沿着森林缓缓推进');
  });
  return { ...hook, getProject: () => project, update, toast };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  for (const mock of Object.values(client)) mock.mockReset();
  vi.mocked(createClient)
    .mockReset()
    .mockReturnValue(client as never);
  vi.mocked(putMedia).mockReset();
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('generation cancellation and retained video tasks', () => {
  it('does not insert an image if a provider responds after the user stops', async () => {
    const pending = deferred<{ src: string; provider: string; model: string }>();
    client.generateImage.mockReturnValue(pending.promise);
    const hook = harness();
    let generation!: Promise<void>;
    await act(async () => {
      generation = hook.result.current.generate();
    });
    const signal = client.generateImage.mock.calls[0][0].signal as AbortSignal;
    act(() => hook.result.current.stop());
    expect(signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve({
        src: 'https://media.example/late.png',
        provider: 'ark',
        model: 'image-model',
      });
      await generation;
    });
    expect(hook.getProject().cards).toEqual([]);
    expect(hook.result.current.active).toBe(false);
    expect(hook.toast).not.toHaveBeenCalledWith(expect.stringContaining('图片已加入'));
  });

  it('does not resubmit a video task that has no provider task ID', async () => {
    const card = jobCard('');
    const hook = harness([card]);
    await act(async () => hook.result.current.resume(card));
    expect(createClient).not.toHaveBeenCalled();
    expect(client.submitVideo).not.toHaveBeenCalled();
    expect(client.getVideo).not.toHaveBeenCalled();
    expect(hook.toast).toHaveBeenCalledWith(expect.stringContaining('供应商后台核对'));
    expect(hook.result.current.active).toBe(false);
  });

  it('keeps the returned video ID and secret-free configuration after stopping the polling', async () => {
    client.submitVideo.mockResolvedValue({ id: 'paid-task-456', status: 'queued' });
    const hook = harness();
    act(() => hook.result.current.setMode('video'));
    let generation!: Promise<void>;
    await act(async () => {
      generation = hook.result.current.generate();
    });
    expect(hook.getProject().cards[0].job?.id).toBe('paid-task-456');
    act(() => hook.result.current.stop());
    await act(async () => {
      await generation;
    });
    const job = hook.getProject().cards[0].job!;
    expect(job).toMatchObject({
      id: 'paid-task-456',
      status: 'paused',
      config: preferenceOnly(originalConfig),
    });
    expect(job.config).not.toHaveProperty('key');
    expect(JSON.stringify(serializeProject(hook.getProject()))).not.toContain(KEY);
    expect(localStorage.getItem(PREFERENCES_KEY)).not.toContain(KEY);
    expect(client.submitVideo).toHaveBeenCalledTimes(1);
    expect(hook.result.current.active).toBe(false);
  });

  it('records a late task ID after stopping without starting polling or another submission', async () => {
    const submitted = deferred<{ id: string; status: string }>();
    client.submitVideo.mockReturnValue(submitted.promise);
    const hook = harness();
    act(() => hook.result.current.setMode('video'));
    let generation!: Promise<void>;
    await act(async () => {
      generation = hook.result.current.generate();
    });
    act(() => hook.result.current.stop());
    await act(async () => {
      submitted.resolve({ id: 'late-task-789', status: 'queued' });
      await generation;
    });
    expect(hook.getProject().cards[0].job).toMatchObject({ id: 'late-task-789', status: 'paused' });
    expect(client.submitVideo).toHaveBeenCalledTimes(1);
    expect(client.getVideo).not.toHaveBeenCalled();
  });

  it('resumes the existing ID using its original parameters and the newly filled key', async () => {
    const card = jobCard();
    const hook = harness([card]);
    const newKey = 'new-current-memory-key';
    act(() =>
      hook.result.current.setConfig({
        ...originalConfig,
        key: newKey,
        baseUrl: originalConfig.baseUrl + '/',
        videoModel: 'current-new-model',
        imageModel: 'current-new-image',
        duration: 12,
        videoRatio: '16:9',
        resolution: '720p',
      }),
    );
    client.getVideo.mockResolvedValue({
      id: card.job!.id,
      status: 'succeeded',
      src: 'https://media.example/result.mp4',
    });
    await act(async () => hook.result.current.resume(card));
    expect(createClient).toHaveBeenCalledExactlyOnceWith({
      ...preferenceOnly(originalConfig),
      key: newKey,
    });
    expect(client.getVideo).toHaveBeenCalledWith({
      id: 'provider-job-123',
      signal: expect.any(AbortSignal),
    });
    expect(client.submitVideo).not.toHaveBeenCalled();
    expect(hook.getProject().cards[0]).toMatchObject({
      kind: 'video',
      src: 'https://media.example/result.mp4',
      duration: 8,
      job: { id: 'provider-job-123', status: 'succeeded', config: preferenceOnly(originalConfig) },
    });
    expect(JSON.stringify(serializeProject(hook.getProject()))).not.toContain(newKey);
    expect(hook.result.current.active).toBe(false);
  });

  it('redacts the key before saving a submission error to a paused job', async () => {
    client.submitVideo.mockRejectedValue(new Error(`provider rejected ${KEY}`));
    const hook = harness();
    act(() => hook.result.current.setMode('video'));
    await act(async () => hook.result.current.generate());
    expect(hook.getProject().cards[0].job?.status).toBe('paused');
    expect(JSON.stringify(serializeProject(hook.getProject()))).not.toContain(KEY);
    expect(hook.getProject().cards[0].job?.error).toContain('[已隐藏]');
    expect(hook.toast).toHaveBeenCalledWith(expect.stringContaining('[已隐藏]'));
  });
  it('sends shared notes with every prompt and reference images with image generation', async () => {
    const hero: Card = {
      id: 'hero',
      x: 0,
      y: 0,
      name: '主角',
      kind: 'image',
      src: 'https://media.example/hero.png',
    };
    let project: ProjectState = {
      ...initialState(),
      cards: [hero],
      consistency: { notes: '红色雨衣', references: ['hero'] },
    };
    const update = vi.fn<UpdateProject>(recipe => {
      const next = structuredClone(project);
      recipe(next);
      project = next;
    });
    client.generateImage.mockResolvedValue({
      src: 'data:image/png;base64,aA==',
      provider: 'ark',
      model: 'image-model',
    });
    client.submitVideo.mockRejectedValue(new Error('stop here'));
    vi.mocked(putMedia).mockResolvedValue('media-1');
    const hook = renderHook(() =>
      useGeneration({ getProject: () => project, update, toast: vi.fn() }),
    );
    act(() => {
      hook.result.current.setConfig({ ...originalConfig });
      hook.result.current.setPrompt('雨夜回头');
    });
    await act(() => hook.result.current.generate());
    expect(client.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '雨夜回头\n\n统一设定（所有镜头保持一致）：红色雨衣',
        references: ['data:image/jpeg;base64,hero'],
      }),
    );
    expect(project.cards.at(-1)).toMatchObject({
      prompt: '雨夜回头',
      label: 'AI 生成图片 · 参考 1',
    });
    act(() => hook.result.current.setPrompt('慢慢推近'));
    await act(() => hook.result.current.generate(hero));
    expect(client.submitVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('统一设定（所有镜头保持一致）：红色雨衣'),
        reference: hero.src,
      }),
    );
  });
});
