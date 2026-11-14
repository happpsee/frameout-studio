// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspace } from './useWorkspace';
import { useGeneration } from './useGeneration';
import { useWorkflow } from './useWorkflow';
import { createClient } from '@frameout/shared';
import { defaults } from '../lib/preferences';
import { getMedia } from '../lib/media-store';
import { initialState, serializeProject } from '../lib/project';
import { createWorkflow } from '../lib/workflow';
import { projectDataKeys } from '../lib/projects';
const TEST_PROJECT = 'test';
const STORAGE_KEY = projectDataKeys(TEST_PROJECT).project;

vi.mock('@frameout/shared', async original => ({
  ...(await original<typeof import('@frameout/shared')>()),
  createClient: vi.fn(),
}));
vi.mock('../lib/media-store', async original => ({
  ...(await original<typeof import('../lib/media-store')>()),
  getMedia: vi.fn(),
}));
const client = { generateImage: vi.fn(), submitVideo: vi.fn(), getVideo: vi.fn() };
const config = { ...defaults('ark'), key: 'fixture-key-never-persist' };

function harness() {
  return renderHook(() => {
    const workspace = useWorkspace(TEST_PROJECT);
    const generation = useGeneration({
      getProject: () => workspace.projectRef.current,
      update: workspace.update,
      toast: vi.fn(),
    });
    const workflow = useWorkflow({ ...workspace, generation, toast: vi.fn(), enabled: true });
    return { workspace, generation, workflow };
  });
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue(client as unknown as ReturnType<typeof createClient>);
  client.generateImage.mockImplementation(async ({ prompt }) => ({
    src: `https://media.example/${encodeURIComponent(prompt)}.png`,
    provider: 'ark',
    model: 'image-model',
  }));
  client.submitVideo.mockResolvedValue({ id: 'paid-video-1', status: 'queued' });
  client.getVideo.mockResolvedValue({
    id: 'paid-video-1',
    status: 'succeeded',
    src: 'https://media.example/clip.mp4',
  });
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:restored-checkpoint'),
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('persisted creative workflow', () => {
  it('reconciles a completed image saved before its step acknowledgement without resubmitting', async () => {
    const project = initialState();
    project.cards = [
      {
        id: 'finished-image',
        name: '已完成首帧',
        x: 0,
        y: 0,
        kind: 'image',
        src: 'https://media.example/saved.png',
      },
    ];
    project.workflow = createWorkflow('已完成首帧', false, config);
    project.workflow.status = 'running';
    project.workflow.steps[0] = {
      ...project.workflow.steps[0],
      status: 'running',
      outputCardId: 'finished-image',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    const hook = harness();
    act(() => hook.result.current.generation.setConfig(config));
    await act(async () => hook.result.current.workflow.start());
    await waitFor(() =>
      expect(hook.result.current.workspace.project.workflow?.status).toBe('completed'),
    );
    expect(client.generateImage).not.toHaveBeenCalled();
    expect(client.submitVideo).not.toHaveBeenCalled();
  });
  it('executes a confirmed image-to-video plan with the generated image as its reference', async () => {
    const hook = harness();
    act(() => hook.result.current.generation.setConfig(config));
    act(() => hook.result.current.workflow.plan('穿过森林', true));
    expect(client.generateImage).not.toHaveBeenCalled();
    await act(async () => hook.result.current.workflow.start());
    await waitFor(
      () => expect(hook.result.current.workspace.project.workflow?.status).toBe('completed'),
      { timeout: 4500 },
    );
    expect(client.generateImage).toHaveBeenCalledTimes(1);
    expect(client.submitVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: 'https://media.example/' + encodeURIComponent('穿过森林') + '.png',
      }),
    );
    expect(hook.result.current.workspace.project.checkpoints).toHaveLength(1);
    expect(hook.result.current.workspace.project.cards).toHaveLength(2);
    expect(JSON.stringify(serializeProject(hook.result.current.workspace.project))).not.toContain(
      config.key,
    );
  });
  it('preserves a late provider task ID and resumes it without resubmitting', async () => {
    let submitted!: (result: { id: string; status: string }) => void;
    client.submitVideo.mockReturnValueOnce(
      new Promise(done => {
        submitted = done;
      }),
    );
    const hook = harness();
    act(() => hook.result.current.generation.setConfig(config));
    act(() => hook.result.current.workflow.plan('镜头一', true));
    await act(async () => hook.result.current.workflow.start());
    await waitFor(() => expect(client.submitVideo).toHaveBeenCalledTimes(1));
    act(() => hook.result.current.workflow.pause());
    await act(async () => {
      submitted({ id: 'late-paid-task', status: 'queued' });
    });
    await waitFor(() =>
      expect(hook.result.current.workspace.project.cards[1].job?.id).toBe('late-paid-task'),
    );
    await act(async () => hook.result.current.workflow.start());
    await waitFor(() =>
      expect(hook.result.current.workspace.project.workflow?.status).toBe('completed'),
    );
    expect(client.submitVideo).toHaveBeenCalledTimes(1);
    expect(client.getVideo).toHaveBeenCalledWith(expect.objectContaining({ id: 'late-paid-task' }));
  });
  it('restores a checkpoint, retains an automatic backup and hydrates its stored media', async () => {
    const project = initialState();
    project.checkpoints = [
      {
        id: 'old',
        name: '已保存的第一稿',
        createdAt: 1,
        state: {
          ...initialState(),
          cards: [
            {
              id: 'old-card',
              name: '旧素材',
              x: 10,
              y: 20,
              kind: 'image',
              src: '',
              mediaId: 'old-media',
            },
          ],
        },
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    vi.mocked(getMedia).mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    const hook = harness();
    act(() => hook.result.current.workspace.restoreCheckpoint('old'));
    await waitFor(() =>
      expect(hook.result.current.workspace.project.cards[0].missingMedia).toBe(false),
    );
    expect(hook.result.current.workspace.project.cards[0].src).toBe('blob:restored-checkpoint');
    expect(hook.result.current.workspace.project.checkpoints).toHaveLength(2);
  });
});
