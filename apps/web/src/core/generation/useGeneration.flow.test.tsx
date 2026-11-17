import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGeneration } from './useGeneration';
import { AIError, createClient } from '@frameout/shared';
import { putMedia } from '../project/media-store';
import { initialState } from '../project/project';
import { defaults } from '../../shell/settings/preferences';
import type { AIConfig, Card, ProjectState, UpdateProject } from '../../types';

vi.mock('@frameout/shared', async importOriginal => ({
  ...(await importOriginal<typeof import('@frameout/shared')>()),
  createClient: vi.fn(),
}));
vi.mock('../project/media-store', async importOriginal => ({
  ...(await importOriginal<typeof import('../project/media-store')>()),
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
  vi.unstubAllGlobals();
});

describe('keeping the prompt', () => {
  it('leaves the prompt in the composer and stores it in full on the card', async () => {
    const h = harness();
    await act(() => h.result.current.generate());
    expect(h.result.current.prompt).toBe(PROMPT);
    expect(h.getProject().cards[0].prompt).toBe(PROMPT);
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

  it('keeps the provider-backend check only for unclear failures', async () => {
    const h = await submitVideo(
      new AIError('请求超时。供应商可能仍在执行', { code: 'TIMEOUT', status: 0 }),
    );
    expect(videoCard(h).job).toMatchObject({ id: '', status: 'paused' });
    h.toast.mockClear();
    await act(() => h.result.current.resume(videoCard(h)));
    expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('供应商后台核对'));
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
    expect(h.getProject().cards[1]).toMatchObject({ prompt: '海边的灯塔', x: 360, y: 0 });
  });
});
