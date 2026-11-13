// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspace } from './useWorkspace';
import { useGeneration } from './useGeneration';
import { useWorkflow } from './useWorkflow';
import { createClient } from '../lib/ai-client';
import { defaults } from '../lib/preferences';
import { failedImage } from '../lib/failed-image';

vi.mock('../lib/ai-client', async original => ({
  ...(await original<typeof import('../lib/ai-client')>()),
  createClient: vi.fn(),
}));
const client = { generateImage: vi.fn(), submitVideo: vi.fn(), getVideo: vi.fn() };
const config = { ...defaults('ark'), key: 'fixture-key-never-persist' };

function harness() {
  return renderHook(() => {
    const workspace = useWorkspace('test');
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
  client.generateImage.mockImplementation(async ({ prompt }) => {
    if (prompt.startsWith('坏')) throw new Error('内容被供应商的安全审核拒绝');
    return {
      src: `https://media.example/${encodeURIComponent(prompt)}.png`,
      provider: 'ark',
      model: 'image-model',
    };
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('a shot plan with a failed image', () => {
  it('keeps the failed card, shows its reason on the step, and replaces it on retry', async () => {
    const hook = harness();
    act(() => hook.result.current.generation.setConfig(config));
    act(() => hook.result.current.workflow.plan('坏镜头\n好镜头', false));
    await act(async () => hook.result.current.workflow.start());
    const steps = () => hook.result.current.workspace.project.workflow!.steps;
    await waitFor(() => expect(steps()[0].status).toBe('failed'));
    expect(hook.result.current.workspace.project.workflow?.status).toBe('paused');
    expect(steps()[0]).toMatchObject({ status: 'failed', error: '内容被供应商的安全审核拒绝' });
    const failed = hook.result.current.workspace.project.cards.find(
      card => card.id === steps()[0].outputCardId,
    );
    expect(failedImage(failed)).toBe(true);

    client.generateImage.mockResolvedValue({
      src: 'https://media.example/again.png',
      provider: 'ark',
      model: 'image-model',
    });
    act(() => hook.result.current.workflow.retry(steps()[0].id));
    expect(hook.result.current.workspace.project.cards.some(card => card.id === failed!.id)).toBe(
      false,
    );
    await act(async () => hook.result.current.workflow.start());
    await waitFor(() =>
      expect(hook.result.current.workspace.project.workflow?.status).toBe('completed'),
    );
    const cards = hook.result.current.workspace.project.cards;
    expect(cards).toHaveLength(2);
    expect(cards.some(card => failedImage(card))).toBe(false);
  });
});
