import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGeneration } from './useGeneration';
import { AIError, createClient, MODERATION_MESSAGE } from '@frameout/shared';
import { putMedia } from '../project/media-store';
import { initialState, restoreProject, serializeProject } from '../project/project';
import { defaults } from '../../shell/settings/preferences';
import { failedImage } from './failed-image';
import { usableReference } from './consistency';
import { regeneration } from './regenerate';
import type { AIConfig, ProjectState, UpdateProject } from '../../types';

vi.mock('@frameout/shared', async importOriginal => ({
  ...(await importOriginal<typeof import('@frameout/shared')>()),
  createClient: vi.fn(),
}));
vi.mock('../project/media-store', async importOriginal => ({
  ...(await importOriginal<typeof import('../project/media-store')>()),
  putMedia: vi.fn(),
}));

const client = { generateImage: vi.fn(), submitVideo: vi.fn(), getVideo: vi.fn() };
const config: AIConfig = { ...defaults('ark'), key: 'fixture-key' };
const PROMPT = '海边的灯塔，黄昏，远处有一艘返航的渔船';

function harness(initial: ProjectState = initialState()) {
  let project = initial;
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

beforeEach(() => {
  localStorage.clear();
  for (const mock of Object.values(client)) mock.mockReset();
  vi.mocked(createClient)
    .mockReset()
    .mockReturnValue(client as never);
  vi.mocked(putMedia).mockReset().mockResolvedValue('media-1');
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

describe('failed image generation', () => {
  it('leaves a card with the prompt and the plain reason', async () => {
    client.generateImage.mockRejectedValue(
      new AIError(MODERATION_MESSAGE, { code: 'CONTENT_REJECTED', status: 400 }),
    );
    const h = harness();
    await act(() => h.result.current.generate());
    const [card] = h.getProject().cards;
    expect(failedImage(card)).toBe(true);
    expect(card).toMatchObject({ prompt: PROMPT, kind: 'image', provider: 'ark' });
    expect(card.job).toMatchObject({ status: 'failed', error: MODERATION_MESSAGE, id: '' });
    expect(h.getProject().selected).toBe(card.id);
    expect(h.toast).toHaveBeenCalledWith(MODERATION_MESSAGE);
    expect(usableReference(card)).toBe(false);
  });

  it('keeps no key in the card and survives save and load', async () => {
    client.generateImage.mockRejectedValue(new Error('fixture-key 无效'));
    const h = harness();
    await act(() => h.result.current.generate());
    const saved = serializeProject(h.getProject());
    expect(JSON.stringify(saved)).not.toContain('fixture-key');
    const [card] = restoreProject(JSON.parse(JSON.stringify(saved))).cards;
    expect(failedImage(card)).toBe(true);
    expect(card.job).toMatchObject({ status: 'failed', error: '[已隐藏] 无效' });
    expect(regeneration(card, [card])).toMatchObject({ ok: true, mode: 'image', replaces: true });
  });

  it('再来一张 puts the new result in place of the failed card', async () => {
    client.generateImage.mockRejectedValueOnce(new Error('网络错误'));
    const h = harness();
    await act(() => h.result.current.generate());
    const failed = h.getProject().cards[0];
    client.generateImage.mockResolvedValue({
      src: 'data:image/png;base64,aA==',
      provider: 'ark',
      model: 'image-model',
    });
    await act(() => h.result.current.regenerate(failed));
    const cards = h.getProject().cards;
    expect(cards).toHaveLength(1);
    expect(failedImage(cards[0])).toBe(false);
    expect(cards[0]).toMatchObject({ prompt: PROMPT, x: failed.x, y: failed.y });
    expect(h.getProject().selected).toBe(cards[0].id);
  });
});
