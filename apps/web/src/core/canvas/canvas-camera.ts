import type { Camera } from '../../types';

type Point = { x: number; y: number };
type Options = {
  initial: Camera;
  onRender: (camera: Camera) => void;
  onRest?: (camera: Camera) => void;
  reducedMotion?: () => boolean;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  now?: () => number;
};
export const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** Size of a card on the canvas at zoom 1. Keep in step with `.fo-card` in styles/studio.css. */
export const CARD_WIDTH = 270;
export const CARD_HEIGHT = 219;
/** Offset from a card's top-left corner to its centre, rounded to whole canvas units. */
export const CARD_CENTER = { x: CARD_WIDTH / 2, y: Math.round(CARD_HEIGHT / 2) };
export function normalizeWheel(
  event: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>,
  pageHeight = 800,
) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, pageHeight) : 1;
  return {
    dx: (Number.isFinite(event.deltaX) ? event.deltaX : 0) * unit,
    dy: (Number.isFinite(event.deltaY) ? event.deltaY : 0) * unit,
  };
}
export function createCamera(options: Options) {
  const request = options.requestFrame ?? requestAnimationFrame;
  const cancelFrame = options.cancelFrame ?? cancelAnimationFrame;
  const now = options.now ?? (() => performance.now());
  let current = { ...options.initial };
  let animation: { from: Camera; target: Camera; start: number } | null = null;
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = true;
  let destroyed = false;
  const get = () => ({ ...current });
  const getTarget = () => ({ ...(animation?.target ?? current) });
  const rest = () => {
    clearTimeout(timer);
    if (!destroyed) options.onRest?.(get());
  };
  function schedule() {
    if (!destroyed && frame === null) frame = request(tick);
  }
  function tick() {
    frame = null;
    if (destroyed) return;
    let finished = false;
    if (animation) {
      const progress = options.reducedMotion?.() ? 1 : clamp((now() - animation.start) / 180, 0, 1);
      const amount = 1 - (1 - progress) ** 3;
      const { from, target } = animation;
      current = {
        x: from.x + (target.x - from.x) * amount,
        y: from.y + (target.y - from.y) * amount,
        zoom: from.zoom + (target.zoom - from.zoom) * amount,
      };
      dirty = true;
      if (progress === 1) {
        animation = null;
        finished = true;
      }
    }
    if (dirty) {
      dirty = false;
      options.onRender(get());
    }
    if (animation) schedule();
    else if (finished) rest();
  }
  function cancel() {
    animation = null;
    clearTimeout(timer);
    if (frame !== null) cancelFrame(frame);
    frame = null;
    if (dirty) schedule();
    return get();
  }
  function set(next: Camera, settings: { animate?: boolean } = {}) {
    if (destroyed) return;
    cancel();
    const target = {
      x: Number.isFinite(next.x) ? next.x : current.x,
      y: Number.isFinite(next.y) ? next.y : current.y,
      zoom: Number.isFinite(next.zoom) ? clamp(next.zoom, 0.15, 4) : current.zoom,
    };
    if (settings.animate && !options.reducedMotion?.())
      animation = { from: get(), target, start: now() };
    else {
      current = target;
      dirty = true;
      timer = setTimeout(rest, 180);
    }
    schedule();
  }
  function zoomTo(zoom: number, point: Point, settings: { animate?: boolean } = {}) {
    if (!Number.isFinite(zoom)) return;
    const base = settings.animate ? getTarget() : get();
    const next = clamp(zoom, 0.15, 4);
    const world = { x: (point.x - base.x) / base.zoom, y: (point.y - base.y) / base.zoom };
    set({ x: point.x - world.x * next, y: point.y - world.y * next, zoom: next }, settings);
  }
  function zoomBy(factor: number, point: Point, settings: { animate?: boolean } = {}) {
    if (Number.isFinite(factor) && factor > 0)
      zoomTo((settings.animate ? getTarget() : get()).zoom * factor, point, settings);
  }
  function pan(dx: number, dy: number) {
    if (Number.isFinite(dx) && Number.isFinite(dy))
      set({ ...current, x: current.x + dx, y: current.y + dy });
  }
  function flush() {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    if (dirty && !destroyed) {
      dirty = false;
      options.onRender(get());
    }
    if (animation) schedule();
  }
  function destroy() {
    cancel();
    destroyed = true;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    dirty = false;
  }
  schedule();
  return { get, getTarget, set, pan, zoomTo, zoomBy, cancel, flush, destroy };
}
export type CameraController = ReturnType<typeof createCamera>;
