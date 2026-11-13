import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useExampleImport } from './useExampleImport';
import { useWorkspace } from './useWorkspace';
import { requestExample, takeExampleRequest } from '../lib/examples';
import { EXAMPLE_LABEL, initialState } from '../lib/project';
import { projectDataKeys } from '../lib/projects';
const TEST_PROJECT = 'test';
const STORAGE_KEY = projectDataKeys(TEST_PROJECT).project;

const camera = { x: 0, y: 0, zoom: 1 };
const viewport = document.createElement('main');

function renderStudio(active: boolean) {
  const restoreCamera = vi.fn();
  const setPrompt = vi.fn();
  const toast = vi.fn();
  const view = renderHook(
    ({ active }: { active: boolean }) => {
      const workspace = useWorkspace(TEST_PROJECT);
      useExampleImport({
        active,
        projectRef: workspace.projectRef,
        update: workspace.update,
        viewportRef: { current: viewport },
        camera,
        restoreCamera,
        setPrompt,
        toast,
      });
      return workspace;
    },
    { initialProps: { active } },
  );
  return { ...view, restoreCamera, setPrompt, toast };
}

beforeEach(() => {
  localStorage.clear();
  takeExampleRequest();
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 600));
});
afterEach(cleanup);

describe('opening a landing example in the studio', () => {
  it('adds the example next to existing work, selects it and prefills the next step', () => {
    const saved = initialState();
    saved.title = '我的片子';
    saved.cards = [
      { id: 'mine', x: 40, y: 60, name: '我的画面', kind: 'image', src: 'https://a.example/1.png' },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    requestExample('forest');
    const { result, setPrompt, restoreCamera, toast } = renderStudio(true);
    const { project } = result.current;
    expect(project.title).toBe('我的片子');
    expect(project.cards).toHaveLength(2);
    expect(project.cards[0]).toMatchObject({ id: 'mine', x: 40, y: 60 });
    const example = project.cards[1];
    expect(example).toMatchObject({ label: EXAMPLE_LABEL, src: '/assets/forest-astronaut.webp' });
    expect(example.x).toBeGreaterThan(40);
    expect(project.selected).toBe(example.id);
    expect(setPrompt.mock.calls[0][0]).toContain('探索者');
    expect(restoreCamera).toHaveBeenCalledOnce();
    expect(toast.mock.calls[0][0]).toContain('图生视频');
    // One undo step removes the example and leaves the user's work.
    act(() => result.current.undo());
    expect(result.current.projectRef.current.cards.map(card => card.id)).toEqual(['mine']);
  });

  it('waits until the studio is shown, and names an empty untitled project after the example', () => {
    requestExample('ocean');
    const { result, rerender } = renderStudio(false);
    expect(result.current.project.cards).toEqual([]);
    rerender({ active: true });
    expect(result.current.project.title).toBe('潮汐之后');
    expect(result.current.project.cards).toHaveLength(1);
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current.project.cards).toHaveLength(1);
  });
});
