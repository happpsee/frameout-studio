// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallback, useRef, useState } from 'react';
import { useCanvas } from './useCanvas';
import type { ProjectState, UpdateProject } from '../../types';

let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
const commits: ProjectState[] = [];
let latestCanvas: () => ReturnType<typeof useCanvas>;
const onFiles = vi.fn();
const addToSequence = vi.fn();
const oneCard: ProjectState['cards'] = [
  { id: 'one', x: 10, y: 20, name: 'one', src: '/assets/a.png', kind: 'image' },
];
function frame() {
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(fn => fn(performance.now()));
  });
}
beforeEach(() => {
  frames.clear();
  commits.length = 0;
  onFiles.mockReset();
  addToSequence.mockReset();
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++nextFrame, fn);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
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
function pointer(
  target: Element,
  type: string,
  id: number,
  x: number,
  y: number,
  shiftKey = false,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: id,
    clientX: x,
    clientY: y,
    button: 0,
    pointerType: 'touch',
    shiftKey,
  });
  fireEvent(target, event);
}
describe('React canvas gestures', () => {
  it('commits one history entry at the end of a drag in world coordinates', () => {
    render(<Harness />);
    frame();
    const card = screen.getByTestId('card');
    pointer(card, 'pointerdown', 1, 100, 100);
    pointer(card, 'pointermove', 1, 120, 110);
    pointer(card, 'pointermove', 1, 140, 120);
    frame();
    pointer(card, 'pointerup', 1, 140, 120);
    expect(commits).toHaveLength(1);
    expect(commits[0].cards[0]).toMatchObject({ x: 60, y: 45 });
  });
});

const threeCards: ProjectState['cards'] = [
  { id: 'one', x: 10, y: 20, name: 'one', src: '/a.png', kind: 'image' },
  { id: 'two', x: 400, y: 20, name: 'two', src: '/b.png', kind: 'image' },
  { id: 'three', x: 10, y: 400, name: 'three', src: '/c.png', kind: 'image' },
];
function click(id: string, shift = false) {
  const target = screen.getByTestId(id === 'one' ? 'card' : id);
  pointer(target, 'pointerdown', 1, 100, 100, shift);
  pointer(target, 'pointerup', 1, 100, 100, shift);
}
const text = (id: string) => screen.getByTestId(id).textContent;
describe('multi-selection', () => {
  it('shift-click adds and removes cards and falls back to a single selection', () => {
    render(<Harness cards={threeCards} />);
    click('one');
    expect(text('selected')).toBe('one');
    click('two', true);
    expect(text('group')).toBe('one,two');
    expect(text('selected')).toBe('');
    click('three', true);
    expect(text('group')).toBe('one,two,three');
    click('two', true);
    click('three', true);
    expect(text('group')).toBe('');
    expect(text('selected')).toBe('one');
    expect(commits).toHaveLength(0);
  });
  it('drags every selected card together as one history entry', () => {
    render(<Harness cards={threeCards} />);
    click('one');
    click('two', true);
    const card = screen.getByTestId('two');
    pointer(card, 'pointerdown', 1, 100, 100);
    pointer(card, 'pointermove', 1, 140, 120);
    frame();
    expect(latestCanvas().positionOf(threeCards[0])).toEqual({ x: 60, y: 45 });
    expect(latestCanvas().positionOf(threeCards[2])).toBe(threeCards[2]);
    pointer(card, 'pointerup', 1, 140, 120);
    expect(commits).toHaveLength(1);
    expect(commits[0].cards.map(c => [c.x, c.y])).toEqual([
      [60, 45],
      [450, 45],
      [10, 400],
    ]);
    expect(text('group')).toBe('one,two');
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
