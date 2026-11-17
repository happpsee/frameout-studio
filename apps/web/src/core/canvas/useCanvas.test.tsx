// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallback, useRef, useState } from 'react';
import { useCanvas } from './useCanvas';
import type { ProjectState, UpdateProject } from '../../types';

const commits: ProjectState[] = [];
let latestCanvas: () => ReturnType<typeof useCanvas>;
const onFiles = vi.fn();
const addToSequence = vi.fn();
const oneCard: ProjectState['cards'] = [
  { id: 'one', x: 10, y: 20, name: 'one', src: '/assets/a.png', kind: 'image' },
];
beforeEach(() => {
  commits.length = 0;
  onFiles.mockReset();
  addToSequence.mockReset();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function Harness({ cards = oneCard }: { cards?: ProjectState['cards'] }) {
  const [project, setProject] = useState<ProjectState>({
    version: 1,
    title: 'test',
    camera: { x: 70, y: 20, zoom: 0.8 },
    selected: null,
    sequence: [],
    cards,
  });
  const projectRef = useRef(project);
  const viewportRef = useRef<HTMLElement>(null);
  const update: UpdateProject = useCallback((recipe, record = true) => {
    const next = JSON.parse(JSON.stringify(projectRef.current));
    recipe(next);
    projectRef.current = next;
    setProject(next);
    if (record) commits.push(next);
  }, []);
  const canvas = useCanvas({
    viewportRef,
    projectRef,
    update,
    addToSequence,
    onFiles,
    onBackgroundDoubleClick: vi.fn(),
  });
  latestCanvas = () => canvas;
  return (
    <>
      <main ref={viewportRef} data-testid="viewport">
        {project.cards.map(card => (
          <article key={card.id} className="fo-card" data-id={card.id}>
            <button className="fo-media" data-testid={card.id === 'one' ? 'card' : card.id}>
              {card.id}
            </button>
          </article>
        ))}
      </main>
      <output data-testid="group">{canvas.selection.ids.join(',')}</output>
      <output data-testid="selected">{project.selected ?? ''}</output>
    </>
  );
}
const threeCards: ProjectState['cards'] = [
  { id: 'one', x: 10, y: 20, name: 'one', src: '/a.png', kind: 'image' },
  { id: 'two', x: 400, y: 20, name: 'two', src: '/b.png', kind: 'image' },
  { id: 'three', x: 10, y: 400, name: 'three', src: '/c.png', kind: 'image' },
];
describe('drag', () => {
  it('saves every moved card in one history entry when the drag ends', () => {
    render(<Harness cards={threeCards} />);
    act(() =>
      latestCanvas().flow.finishDrag(
        [
          { id: 'one', x: 60, y: 45 },
          { id: 'two', x: 450, y: 45 },
        ],
        0,
      ),
    );
    expect(commits).toHaveLength(1);
    expect(commits[0].cards.map(c => [c.x, c.y])).toEqual([
      [60, 45],
      [450, 45],
      [10, 400],
    ]);
    expect(addToSequence).not.toHaveBeenCalled();
  });
});
function paste(target: Element, files: File[]) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.assign(event, { clipboardData: { files } });
  fireEvent(target, event);
  return event;
}
describe('paste', () => {
  const image = new File(['x'], 'image.png', { type: 'image/png' });
  it('imports a pasted image at the viewport centre', () => {
    render(<Harness />);
    const event = paste(document.body, [image]);
    expect(event.defaultPrevented).toBe(true);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]).toHaveLength(1);
    expect([...onFiles.mock.calls[0][0]]).toEqual([image]);
  });
});
