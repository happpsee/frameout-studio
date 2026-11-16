import { act, renderHook } from '@testing-library/react';
import { produce } from 'immer';
import { expect, test, vi } from 'vitest';
import type { AIConfig, ProjectState } from '../../types';
import type { EngineEvent, EngineTask } from './engine-tasks';
import { FAILED_IMAGE_LABEL } from './failed-image';
import { ENGINE_IMAGE_LABEL, useEngineTasks } from './useEngineTasks';

const engine = vi.hoisted(() => ({
  listener: (_event: EngineEvent) => {},
  acknowledged: [] as string[],
}));
vi.mock('../../platform', () => ({ isDesktop: () => true }));
vi.mock('../project/media-store', () => ({ putMedia: async () => 'media-1' }));
vi.mock('./engine-tasks', async importOriginal => ({
  ...(await importOriginal<typeof import('./engine-tasks')>()),
  addImageTask: async () => {},
  addVideoTask: async () => {},
  cancelTask: async () => {},
  taskResult: async () => new Blob(['png'], { type: 'image/png' }),
  acknowledgeTask: async (id: string) => void engine.acknowledged.push(id),
  watchTasks: (listener: (event: EngineEvent) => void) => {
    engine.listener = listener;
    return () => {};
  },
}));

const CONFIG = {
  provider: 'ark',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  key: 'test-only-key',
  imageModel: 'model',
  imageSize: '2K',
} as AIConfig;

URL.createObjectURL = () => 'blob:result';

function setup() {
  let project = { cards: [] } as unknown as ProjectState;
  const update = (recipe: (draft: ProjectState) => void) => {
    project = produce(project, recipe);
  };
  const { result } = renderHook(() => useEngineTasks({ projectId: 'p1', update }));
  const run = (prompt: string) =>
    result.current!.run(
      {
        text: prompt,
        prompt,
        references: [],
        config: CONFIG,
        at: { x: 0, y: 0 },
        label: 'AI 生成图片',
      },
      new AbortController().signal,
    );
  const ended = (
    status: EngineTask['status'],
    cardId: string,
    error?: string,
    video?: Partial<EngineTask>,
  ) =>
    engine.listener({
      type: 'task',
      task: {
        id: project.cards.find(card => card.id === cardId)!.job!.id,
        kind: 'image',
        ...video,
        status,
        needsKey: false,
        context: { projectId: 'p1', cardId, label: 'AI 生成图片' },
        ...(error ? { error: { code: 'X', message: error } } : {}),
      },
    });
  const runVideo = (prompt: string) =>
    result.current!.runVideo(
      { text: prompt, prompt, config: CONFIG, at: { x: 0, y: 0 } },
      new AbortController().signal,
    );
  return { run, runVideo, ended, card: () => project.cards[0] };
}

test('a finished task replaces its placeholder with the image, then is acknowledged', async () => {
  const { run, ended, card } = setup();
  let outcome: unknown;
  await act(async () => {
    const running = run('海边').then(value => (outcome = value));
    await Promise.resolve();
    expect(card().label).toBe(ENGINE_IMAGE_LABEL);
    ended('succeeded', card().id);
    await running;
  });
  expect(outcome).toEqual({ ok: true });
  expect(card()).toMatchObject({ mediaId: 'media-1', label: 'AI 生成图片', kind: 'image' });
  expect(card().job).toBeUndefined();
  expect(engine.acknowledged).toHaveLength(1);
});

test('an interrupted task leaves a failed card that says it may have been charged', async () => {
  const { run, ended, card } = setup();
  await act(async () => {
    const running = run('雨夜');
    await Promise.resolve();
    ended('interrupted', card().id, '可能已经生成并计费');
    await running;
  });
  expect(card().label).toBe(FAILED_IMAGE_LABEL);
  expect(card().job?.error).toBe('可能已经生成并计费');
});

test('a video the engine lost track of can still be queried by its provider job id', async () => {
  const { runVideo, ended, card } = setup();
  await act(async () => {
    const running = runVideo('雨夜');
    await Promise.resolve();
    expect(card().job?.engine).toBe(true);
    ended('interrupted', card().id, '没能查到视频结果', { kind: 'video', providerJobId: 'cgt-1' });
    await running;
  });
  expect(card().job).toMatchObject({ id: 'cgt-1', status: 'paused', engine: false });
});
