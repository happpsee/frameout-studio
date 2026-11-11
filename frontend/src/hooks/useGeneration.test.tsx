import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGeneration } from './useGeneration';
import { createClient } from '../lib/ai-client';
import { putMedia } from '../lib/media-store';
import { initialState, preferenceOnly, serializeProject } from '../lib/project';
import { defaults, PREFERENCES_KEY } from '../lib/preferences';
import type { AIConfig, Card, ProjectState, UpdateProject } from '../types';

vi.mock('../lib/ai-client', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/ai-client')>(),
  createClient: vi.fn(),
}));
vi.mock('../lib/media-store', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/media-store')>(),
  putMedia: vi.fn(),
}));

const client = { generateImage: vi.fn(), submitVideo: vi.fn(), getVideo: vi.fn() };
const KEY = 'fixture-only-secret-never-save';
const originalConfig: AIConfig = {
  ...defaults('ark'), key: KEY, imageModel: 'original-image-model', videoModel: 'original-video-model',
  duration: 8, videoRatio: '4:3', resolution: '1080p',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function jobCard(id = 'provider-job-123'): Card {
  return {
    id: 'video-card', x: 10, y: 20, name: '待完成镜头', src: '/assets/forest-astronaut.png', kind: 'image',
    job: { id, provider: 'ark', prompt: '沿着森林缓缓推进', status: 'paused', config: preferenceOnly(originalConfig) },
  };
}

function harness(cards: Card[] = []) {
  let project: ProjectState = { ...initialState(), cards };
  const update = vi.fn<UpdateProject>((recipe) => {
    const next = structuredClone(project);
    recipe(next);
    project = next;
  });
  const toast = vi.fn();
  const hook = renderHook(() => useGeneration({ getProject: () => project, update, toast }));
  act(() => { hook.result.current.setConfig({ ...originalConfig }); hook.result.current.setPrompt('沿着森林缓缓推进'); });
  return { ...hook, getProject: () => project, update, toast };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  for (const mock of Object.values(client)) mock.mockReset();
  vi.mocked(createClient).mockReset().mockReturnValue(client as never);
  vi.mocked(putMedia).mockReset();
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:generated-result');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('generation cancellation and retained video tasks', () => {
  it('opens a temporary desktop asset in the default browser and reports failures', async () => {
    const openTemporaryDownload = vi.fn(async (_url: string) => {});
    vi.stubGlobal('frameoutDesktop', { storage: { write: vi.fn(async () => {}) }, openTemporaryDownload });
    const card: Card = { ...jobCard(), src: 'https://media.example/result.png', job: undefined, remoteTemporary: true };
    const hook = harness([card]);
    await hook.result.current.download(card);
    expect(openTemporaryDownload).toHaveBeenCalledWith(card.src);
    openTemporaryDownload.mockRejectedValueOnce(new Error('browser unavailable'));
    await hook.result.current.download(card);
    expect(hook.toast).toHaveBeenCalledWith('无法在浏览器打开临时素材链接');
  });

  it('does not insert an image if a provider responds after the user stops', async () => {
    const pending = deferred<{ src: string; provider: string; model: string }>();
    client.generateImage.mockReturnValue(pending.promise);
    const hook = harness();
    let generation!: Promise<void>;
    await act(async () => { generation = hook.result.current.generate(); });
    const signal = client.generateImage.mock.calls[0][0].signal as AbortSignal;
    act(() => hook.result.current.stop());
    expect(signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve({ src: 'https://media.example/late.png', provider: 'ark', model: 'image-model' });
      await generation;
    });
    expect(hook.getProject().cards).toEqual([]);
    expect(hook.result.current.active).toBe(false);
    expect(hook.toast).not.toHaveBeenCalledWith(expect.stringContaining('图片已加入'));
  });

  it('does not insert an image when saving the media finishes after stopping', async () => {
    const stored = deferred<string>();
    client.generateImage.mockResolvedValue({ src: 'data:image/png;base64,aA==', provider: 'ark', model: 'image-model' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['fixture'], { type: 'image/png' }) }));
    vi.mocked(putMedia).mockReturnValue(stored.promise);
    const hook = harness();
    let generation!: Promise<void>;
    await act(async () => { generation = hook.result.current.generate(); });
    expect(putMedia).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.stop());
    await act(async () => { stored.resolve('stored-media-id'); await generation; });
    expect(hook.getProject().cards).toEqual([]);
    expect(hook.result.current.active).toBe(false);
  });

  it('does not update the project if a pending image request finishes after unmount', async () => {
    const pending = deferred<{ src: string; provider: string; model: string }>();
    client.generateImage.mockReturnValue(pending.promise);
    const hook = harness();
    let generation!: Promise<void>;
    await act(async () => { generation = hook.result.current.generate(); });
    hook.unmount();
    await act(async () => { pending.resolve({ src: 'https://media.example/late.png', provider: 'ark', model: 'test' }); await generation; });
    expect(hook.update).not.toHaveBeenCalled();
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
    await act(async () => { generation = hook.result.current.generate(); });
    expect(hook.getProject().cards[0].job?.id).toBe('paid-task-456');
    act(() => hook.result.current.stop());
    await act(async () => { await generation; });
    const job = hook.getProject().cards[0].job!;
    expect(job).toMatchObject({ id: 'paid-task-456', status: 'paused', config: preferenceOnly(originalConfig) });
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
    await act(async () => { generation = hook.result.current.generate(); });
    act(() => hook.result.current.stop());
    await act(async () => { submitted.resolve({ id: 'late-task-789', status: 'queued' }); await generation; });
    expect(hook.getProject().cards[0].job).toMatchObject({ id: 'late-task-789', status: 'paused' });
    expect(client.submitVideo).toHaveBeenCalledTimes(1);
    expect(client.getVideo).not.toHaveBeenCalled();
  });

  it('resumes the existing ID using its original parameters and the newly filled key', async () => {
    const card = jobCard();
    const hook = harness([card]);
    const newKey = 'new-current-memory-key';
    act(() => hook.result.current.setConfig({ ...originalConfig, key: newKey, baseUrl: originalConfig.baseUrl + '/', videoModel: 'current-new-model', imageModel: 'current-new-image', duration: 12, videoRatio: '16:9', resolution: '720p' }));
    client.getVideo.mockResolvedValue({ id: card.job!.id, status: 'succeeded', src: 'https://media.example/result.mp4' });
    await act(async () => hook.result.current.resume(card));
    expect(createClient).toHaveBeenCalledExactlyOnceWith({ ...preferenceOnly(originalConfig), key: newKey });
    expect(client.getVideo).toHaveBeenCalledWith({ id: 'provider-job-123', signal: expect.any(AbortSignal) });
    expect(client.submitVideo).not.toHaveBeenCalled();
    expect(hook.getProject().cards[0]).toMatchObject({ kind: 'video', src: 'https://media.example/result.mp4', duration: 8, job: { id: 'provider-job-123', status: 'succeeded', config: preferenceOnly(originalConfig) } });
    expect(JSON.stringify(serializeProject(hook.getProject()))).not.toContain(newKey);
    expect(hook.result.current.active).toBe(false);
  });

  it('does not let a stopped query overwrite a later successful resume of the same card', async () => {
    const oldQuery = deferred<{ id: string; status: string; src?: string }>();
    client.getVideo.mockReturnValueOnce(oldQuery.promise).mockResolvedValueOnce({
      id: 'provider-job-123', status: 'succeeded', src: 'https://media.example/new-completed.mp4',
    });
    const hook = harness([jobCard()]);
    let oldResume!: Promise<void>;
    await act(async () => { oldResume = hook.result.current.resume(hook.getProject().cards[0]); });
    const oldSignal = client.getVideo.mock.calls[0][0].signal as AbortSignal;
    act(() => hook.result.current.stop());
    expect(oldSignal.aborted).toBe(true);

    await act(async () => hook.result.current.resume(hook.getProject().cards[0]));
    const completed = structuredClone(hook.getProject().cards[0]);
    expect(completed).toMatchObject({
      kind: 'video', src: 'https://media.example/new-completed.mp4',
      job: { id: 'provider-job-123', status: 'succeeded' },
    });
    expect(completed.job).not.toHaveProperty('error');
    const updatesBeforeOldFailure = hook.update.mock.calls.length;
    const toastsBeforeOldFailure = hook.toast.mock.calls.length;

    await act(async () => {
      oldQuery.reject(new DOMException('stopped query rejected late', 'AbortError'));
      await oldResume;
    });
    expect(hook.getProject().cards[0]).toEqual(completed);
    expect(hook.update).toHaveBeenCalledTimes(updatesBeforeOldFailure);
    expect(hook.toast).toHaveBeenCalledTimes(toastsBeforeOldFailure);
    expect(hook.result.current.active).toBe(false);
    expect(client.getVideo).toHaveBeenCalledTimes(2);
    expect(client.submitVideo).not.toHaveBeenCalled();
  });

  it.each([
    { provider: 'compatible', baseUrl: 'https://custom.example/v1' },
    { provider: 'ark', baseUrl: 'https://other.example/api/v3' },
  ] as const)('requires switching back before querying a task from a different provider or address: $baseUrl', async changed => {
    const card = jobCard();
    const hook = harness([card]);
    act(() => hook.result.current.setConfig({ ...originalConfig, ...changed }));
    await act(async () => hook.result.current.resume(card));
    expect(createClient).not.toHaveBeenCalled();
    expect(client.getVideo).not.toHaveBeenCalled();
    expect(hook.toast).toHaveBeenCalledWith(expect.stringContaining('原来的供应商'));
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

  it('keeps provider failure details secret-free in a saved video job', async () => {
    const card = jobCard();
    const hook = harness([card]);
    client.getVideo.mockResolvedValue({ id: card.job!.id, status: 'failed', error: `rejected credential ${KEY}` });
    await act(async () => hook.result.current.resume(card));
    expect(hook.getProject().cards[0].job?.status).toBe('failed');
    expect(JSON.stringify(serializeProject(hook.getProject()))).not.toContain(KEY);
    expect(hook.getProject().cards[0].job?.error).toContain('[已隐藏]');
  });
  it('opens the settings instead of a toast when the key is missing', async () => {
    const openSettings = vi.fn(), toast = vi.fn();
    const hook = renderHook(() => useGeneration({ getProject: initialState, update: vi.fn(), toast, openSettings }));
    act(() => { hook.result.current.setConfig({ ...originalConfig, key: '' }); hook.result.current.setPrompt('森林'); });
    await act(() => hook.result.current.generate());
    expect(openSettings).toHaveBeenCalledWith(expect.stringContaining('提示词已保留'));
    expect(toast).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(hook.result.current.prompt).toBe('森林');
  });
});
