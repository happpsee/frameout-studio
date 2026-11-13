import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCamera, normalizeWheel } from './canvas-camera';

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach(fn => fn());
  vi.useRealTimers();
});
function harness() {
  let time = 0;
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const render = vi.fn();
  const rest = vi.fn();
  const camera = createCamera({
    initial: { x: 70, y: 20, zoom: 0.8 },
    onRender: render,
    onRest: rest,
    now: () => time,
    requestFrame: fn => {
      frames.set(++id, fn);
      return id;
    },
    cancelFrame: i => {
      frames.delete(i);
    },
  });
  const frame = (next: number) => {
    time = next;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(fn => fn(time));
  };
  cleanup.push(camera.destroy);
  frame(0);
  render.mockClear();
  return { camera, frames, frame, render, rest };
}
describe('canvas camera', () => {
  it('coalesces direct input into one frame', () => {
    const h = harness();
    h.camera.pan(3, 4);
    h.camera.pan(5, 6);
    expect(h.render).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(1);
    h.frame(16);
    expect(h.render).toHaveBeenCalledOnce();
    expect(h.camera.get()).toEqual({ x: 78, y: 30, zoom: 0.8 });
  });
  it('keeps the cursor world point fixed through clamped zoom', () => {
    const { camera } = harness();
    const p = { x: 531.25, y: 218.5 };
    const base = camera.get();
    const world = { x: (p.x - base.x) / base.zoom, y: (p.y - base.y) / base.zoom };
    for (const f of [1.12, 20, 0.01, 2.5]) {
      camera.zoomBy(f, p);
      const c = camera.get();
      expect(c.x + world.x * c.zoom).toBeCloseTo(p.x, 8);
      expect(c.y + world.y * c.zoom).toBeCloseTo(p.y, 8);
      expect(c.zoom).toBeGreaterThanOrEqual(0.15);
      expect(c.zoom).toBeLessThanOrEqual(4);
    }
  });
  it('accumulates animated zoom and interrupts at the visible position', () => {
    const { camera, frame } = harness();
    camera.zoomBy(1.2, { x: 400, y: 250 }, { animate: true });
    camera.zoomBy(1.2, { x: 400, y: 250 }, { animate: true });
    expect(camera.getTarget().zoom).toBeCloseTo(1.152);
    frame(70);
    const visible = camera.get();
    camera.pan(12, -9);
    frame(300);
    expect(camera.get()).toEqual({ ...visible, x: visible.x + 12, y: visible.y - 9 });
    expect(camera.getTarget()).toEqual(camera.get());
  });
  it('stops callbacks after destroy', () => {
    vi.useFakeTimers();
    const { camera, frame, render, rest } = harness();
    camera.pan(1, 2);
    camera.destroy();
    frame(500);
    vi.runAllTimers();
    expect(render).not.toHaveBeenCalled();
    expect(rest).not.toHaveBeenCalled();
  });
  it('normalizes line and page wheel deltas', () => {
    expect(normalizeWheel({ deltaX: 2, deltaY: -3, deltaMode: 1 })).toEqual({ dx: 32, dy: -48 });
    expect(normalizeWheel({ deltaX: 2, deltaY: -3, deltaMode: 2 }, 600)).toEqual({
      dx: 1200,
      dy: -1800,
    });
  });
});
