// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallback, useRef, useState } from 'react';
import { useCanvas } from './useCanvas';
import type { ProjectState, UpdateProject } from '../types';

let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
const commits: ProjectState[] = [];
let latestProject: () => ProjectState;
function frame() { act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(performance.now())); }); }
beforeEach(() => {
  frames.clear(); commits.length = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++nextFrame, fn); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Harness() {
  const [project, setProject] = useState<ProjectState>({ version: 1, title: 'test', camera: { x: 70, y: 20, zoom: 0.8 }, selected: null, sequence: [], cards: [{ id: 'one', x: 10, y: 20, name: 'one', src: '/assets/a.png', kind: 'image' }] });
  const projectRef = useRef(project), viewportRef = useRef<HTMLElement>(null);
  latestProject = () => projectRef.current;
  const update: UpdateProject = useCallback((recipe, record = true) => { const next = JSON.parse(JSON.stringify(projectRef.current)); recipe(next); projectRef.current = next; setProject(next); if (record) commits.push(next); }, []);
  const canvas = useCanvas({ viewportRef, projectRef, update, addToSequence: vi.fn(), onFiles: vi.fn(), onBackgroundDoubleClick: vi.fn() });
  return <><main ref={viewportRef} data-testid="viewport"><article className="fo-card" data-id="one"><button className="fo-media" data-testid="card">one</button></article></main><output data-testid="camera">{JSON.stringify(canvas.camera)}</output><output data-testid="position">{JSON.stringify(canvas.dragPosition)}</output><output data-testid="saved">{JSON.stringify(project.cards[0])}</output></>;
}
function pointer(target: Element, type: string, id: number, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: id, clientX: x, clientY: y, button: 0, pointerType: 'touch' });
  fireEvent(target, event);
}
describe('React canvas gestures', () => {
  it.each(['pointercancel', 'lostpointercapture'])('%s restores the original drag position without recording history', (reason) => {
    render(<Harness />); frame(); const card = screen.getByTestId('card');
    pointer(card, 'pointerdown', 1, 100, 100); pointer(card, 'pointermove', 1, 140, 120); frame();
    expect(JSON.parse(screen.getByTestId('position').textContent!)).toEqual({ id: 'one', x: 60, y: 45 });
    pointer(card, reason, 1, 140, 120); frame();
    expect(screen.getByTestId('position').textContent).toBe('null');
    expect(JSON.parse(screen.getByTestId('saved').textContent!).x).toBe(10);
    expect(commits).toHaveLength(0);
  });
  it('commits one history entry at the end of a drag in world coordinates', () => {
    render(<Harness />); frame(); const card = screen.getByTestId('card');
    pointer(card, 'pointerdown', 1, 100, 100); pointer(card, 'pointermove', 1, 120, 110); pointer(card, 'pointermove', 1, 140, 120); frame(); pointer(card, 'pointerup', 1, 140, 120);
    expect(commits).toHaveLength(1); expect(commits[0].cards[0]).toMatchObject({ x: 60, y: 45 });
  });
  it('continues panning with one finger after ending a pinch without a jump', () => {
    render(<Harness />); frame(); const viewport = screen.getByTestId('viewport');
    pointer(viewport, 'pointerdown', 1, 100, 100); pointer(viewport, 'pointerdown', 2, 200, 100); pointer(viewport, 'pointermove', 2, 240, 100); frame();
    const before = JSON.parse(screen.getByTestId('camera').textContent!);
    pointer(viewport, 'pointerup', 2, 240, 100); pointer(viewport, 'pointermove', 1, 120, 110); frame();
    const after = JSON.parse(screen.getByTestId('camera').textContent!);
    expect(after.zoom).toBeCloseTo(before.zoom); expect(after.x).toBeCloseTo(before.x + 20); expect(after.y).toBeCloseTo(before.y + 10);
    pointer(viewport, 'pointerup', 1, 120, 110);
  });
  it('keeps the synchronous project ref at the displayed camera before save debounce', () => {
    render(<Harness />); frame();
    fireEvent.wheel(screen.getByTestId('viewport'), { deltaX: 30, deltaY: -20 }); frame();
    const visible = JSON.parse(screen.getByTestId('camera').textContent!);
    expect(latestProject().camera).toEqual(visible);
    expect(visible).toMatchObject({ x: 40, y: 40, zoom: 0.8 });
  });
  it('lets Space activate a focused button instead of stealing it for pan', () => {
    render(<Harness />); frame();
    const activate = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    fireEvent(screen.getByTestId('card'), activate); expect(activate.defaultPrevented).toBe(false);
    const pan = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    fireEvent(screen.getByTestId('viewport'), pan); expect(pan.defaultPrevented).toBe(true);
    fireEvent.keyUp(document, { key: ' ', code: 'Space' });
  });
});
