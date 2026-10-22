/* FRAMEOUT · frame-coalesced canvas camera. Points use viewport CSS pixels. */
(function (root, factory) {
  'use strict';
  const api = factory();
  root.FrameoutCamera = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';

  const DURATION = 180;
  const REST_DELAY = 180;
  const finite = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  function clamp(value, min, max, fallback = min) {
    return Math.min(max, Math.max(min, finite(value, finite(fallback, min))));
  }

  function normalizeWheel(event, pageHeight) {
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, finite(pageHeight, 800)) : 1;
    return { dx: finite(event.deltaX, 0) * unit, dy: finite(event.deltaY, 0) * unit };
  }

  function create(options = {}) {
    const minZoom = Math.max(0.001, finite(options.minZoom, 0.15));
    const maxZoom = Math.max(minZoom, finite(options.maxZoom, 4));
    const requestFrame = options.requestFrame || ((callback) => requestAnimationFrame(callback));
    const cancelFrame = options.cancelFrame || ((id) => cancelAnimationFrame(id));
    const clock = options.now || (() => performance.now());
    const reducedMotion = typeof options.reducedMotion === 'function' ? options.reducedMotion : () => false;
    const onRender = typeof options.onRender === 'function' ? options.onRender : () => {};
    const onRest = typeof options.onRest === 'function' ? options.onRest : () => {};
    let current = sanitize(options.initial || {}, { x: 0, y: 0, zoom: 1 });
    let animation = null;
    let frameId = null;
    let restTimer = null;
    let dirty = true;
    let destroyed = false;

    function sanitize(value, fallback) {
      return {
        x: finite(value.x, fallback.x),
        y: finite(value.y, fallback.y),
        zoom: clamp(value.zoom, minZoom, maxZoom, fallback.zoom),
      };
    }

    function get() { return { ...current }; }
    function getTarget() { return { ...(animation ? animation.target : current) }; }

    function clearRest() {
      if (restTimer !== null) clearTimeout(restTimer);
      restTimer = null;
    }

    function notifyRest() {
      clearRest();
      if (!destroyed) onRest(get());
    }

    function deferRest() {
      clearRest();
      restTimer = setTimeout(notifyRest, REST_DELAY);
    }

    function schedule() {
      if (!destroyed && frameId === null) frameId = requestFrame(tick);
    }

    function tick() {
      frameId = null;
      if (destroyed) return;
      let finished = false;
      if (animation) {
        const progress = reducedMotion() ? 1 : clamp((clock() - animation.start) / DURATION, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const { from, target } = animation;
        current = progress === 1 ? { ...target } : {
          x: from.x + (target.x - from.x) * eased,
          y: from.y + (target.y - from.y) * eased,
          zoom: from.zoom + (target.zoom - from.zoom) * eased,
        };
        dirty = true;
        if (progress === 1) {
          animation = null;
          finished = true;
        }
      }
      if (dirty) {
        dirty = false;
        onRender(get());
      }
      if (animation) schedule();
      else if (finished) notifyRest();
    }

    function stopAnimation() {
      animation = null;
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      clearRest();
    }

    function set(next, settings = {}) {
      if (destroyed) return get();
      const target = sanitize(next || {}, current);
      stopAnimation();
      const changed = target.x !== current.x || target.y !== current.y || target.zoom !== current.zoom;
      if (settings.animate && !reducedMotion() && changed) {
        animation = { from: get(), target, start: clock() };
      } else {
        current = target;
        dirty = true;
        deferRest();
      }
      schedule();
      return get();
    }

    function pan(dx, dy) {
      if (destroyed) return get();
      dx = finite(dx, 0);
      dy = finite(dy, 0);
      if (!dx && !dy) return get();
      return set({ x: current.x + dx, y: current.y + dy, zoom: current.zoom });
    }

    function zoomTo(zoom, point, settings = {}) {
      if (destroyed) return get();
      const base = settings.animate ? getTarget() : current;
      const nextZoom = clamp(zoom, minZoom, maxZoom, base.zoom);
      const anchor = { x: finite(point && point.x, 0), y: finite(point && point.y, 0) };
      const world = { x: (anchor.x - base.x) / base.zoom, y: (anchor.y - base.y) / base.zoom };
      return set({ x: anchor.x - world.x * nextZoom, y: anchor.y - world.y * nextZoom, zoom: nextZoom }, settings);
    }

    function zoomBy(factor, point, settings = {}) {
      if (destroyed || !Number.isFinite(factor) || factor <= 0) return get();
      const base = settings.animate ? getTarget() : current;
      return zoomTo(base.zoom * factor, point, settings);
    }

    function flush() {
      if (destroyed) return get();
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      if (dirty) {
        dirty = false;
        onRender(get());
      }
      if (animation) schedule();
      return get();
    }

    function cancel() {
      if (destroyed) return get();
      stopAnimation();
      if (dirty) schedule();
      return get();
    }

    function destroy() {
      if (destroyed) return;
      stopAnimation();
      dirty = false;
      destroyed = true;
    }

    schedule();
    return { get, getTarget, set, pan, zoomTo, zoomBy, flush, cancel, destroy };
  }

  return { create, normalizeWheel, clamp };
});
