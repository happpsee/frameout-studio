import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Camera, Card, ProjectState, UpdateProject } from '../../types';
import { NOTE_HEIGHT, NOTE_WIDTH } from './notes';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  clamp,
  createCamera,
  normalizeWheel,
  type CameraController,
} from './canvas-camera';
import { cardsInRect, rectBetween, visualOrder, type Rect } from './canvas-selection';
import { useMultiSelection } from './useMultiSelection';
import { useClipboardImport } from './useClipboardImport';

const blocked =
  '.fo-composer,.fo-selection-actions,.fo-card-prompt,.fo-shot-list,.fo-canvas-tools,.fo-camera-tools,.fo-canvas-intro';
/** Notes handle their own pointer input: typing, and dragging by the header. */
const ownInput = `${blocked},.fo-note`;
type Point = { x: number; y: number };
type Drag = {
  kind: 'card' | 'camera' | 'marquee';
  pointerId: number;
  id?: string;
  /** Every card moved with `id` when it belongs to a multi-selection. */
  group?: string[];
  start: Point;
  origin: Point;
  moved: boolean;
};
type Options = {
  active?: boolean;
  viewportRef: RefObject<HTMLElement | null>;
  projectRef: RefObject<ProjectState>;
  update: UpdateProject;
  addToSequence: (ids: string | string[]) => void;
  onFiles: (files: FileList, position?: Point) => void;
  onBackgroundDoubleClick: () => void;
};
export function useCanvas(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const controller = useRef<CameraController | null>(null);
  const [camera, setCamera] = useState<Camera>(options.projectRef.current.camera);
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const [fileDrop, setFileDrop] = useState(false);
  const [dragPosition, setDragPosition] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const [groupDrag, setGroupDrag] = useState<{ ids: string[]; dx: number; dy: number } | null>(
    null,
  );
  /** Shift-drag selection box in viewport pixels. */
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const cancelGesture = useRef<() => void>(() => {});
  const selection = useMultiSelection({
    projectRef: options.projectRef,
    update: options.update,
    beforeRemove: () => cancelGesture.current(),
  });
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useClipboardImport(latest);
  const cancelActiveGesture = useCallback(() => cancelGesture.current(), []);
  const restoreCamera = useCallback((value: Camera) => {
    controller.current?.set(value);
    controller.current?.flush();
  }, []);
  const suppressUntil = useRef(0);

  const viewportPoint = useCallback((x?: number, y?: number) => {
    const rect = latest.current.viewportRef.current?.getBoundingClientRect();
    return {
      x: x === undefined ? (rect?.width ?? 800) / 2 : x - (rect?.left ?? 0),
      y: y === undefined ? Math.max(80, (rect?.height ?? 600) / 2 - 60) : y - (rect?.top ?? 0),
    };
  }, []);
  const zoomBy = useCallback(
    (factor: number, x?: number, y?: number, animate = true) => {
      if (latest.current.active !== false)
        controller.current?.zoomBy(factor, viewportPoint(x, y), { animate });
    },
    [viewportPoint],
  );
  const zoomTo = useCallback(
    (value: number) => {
      if (latest.current.active !== false)
        controller.current?.zoomTo(value / 100, viewportPoint(), { animate: true });
    },
    [viewportPoint],
  );
  const fit = useCallback((animate = true) => {
    if (latest.current.active === false) return;
    const viewport = latest.current.viewportRef.current;
    if (!viewport?.clientWidth) return;
    const { cards, notes = [] } = latest.current.projectRef.current;
    const boxes = [
      ...cards.map(c => ({ x: c.x, y: c.y, right: c.x + CARD_WIDTH, bottom: c.y + CARD_HEIGHT })),
      ...notes.map(n => ({ x: n.x, y: n.y, right: n.x + NOTE_WIDTH, bottom: n.y + NOTE_HEIGHT })),
    ];
    if (!boxes.length) {
      controller.current?.set({ x: 60, y: 20, zoom: 0.8 }, { animate });
      return;
    }
    const left = Math.min(...boxes.map(box => box.x));
    const top = Math.min(...boxes.map(box => box.y));
    const width = Math.max(...boxes.map(box => box.right)) - left;
    const height = Math.max(...boxes.map(box => box.bottom)) - top;
    const safeLeft = viewport.clientWidth < 600 ? 68 : 95;
    const availableWidth = Math.max(100, viewport.clientWidth - safeLeft - 24);
    const availableHeight = Math.max(100, viewport.clientHeight - 245);
    const zoom = clamp(
      Math.min(availableWidth / (width + 60), availableHeight / (height + 60)),
      0.15,
      1.5,
    );
    controller.current?.set(
      {
        zoom,
        x: safeLeft + (availableWidth - width * zoom) / 2 - left * zoom,
        y: 60 + (availableHeight - height * zoom) / 2 - top * zoom,
      },
      { animate },
    );
  }, []);
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const point = viewportPoint(clientX, clientY);
      const current = controller.current?.get() ?? latest.current.projectRef.current.camera;
      return { x: (point.x - current.x) / current.zoom, y: (point.y - current.y) / current.zoom };
    },
    [viewportPoint],
  );

  useEffect(() => {
    const element = latest.current.viewportRef.current;
    if (!element) return;
    const viewport: HTMLElement = element;
    const camera = createCamera({
      initial: latest.current.projectRef.current.camera,
      onRender: value => {
        // The ref is also read synchronously by pagehide/export while the saved
        // project state is debounced. Keep it in step with the displayed frame.
        latest.current.projectRef.current = { ...latest.current.projectRef.current, camera: value };
        setCamera(value);
      },
      onRest: value =>
        latest.current.update(draft => {
          draft.camera = value;
        }, false),
      reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    controller.current = camera;
    const pointers = new Map<number, Point>();
    const captures = new Map<number, Element>();
    let drag: Drag | null = null;
    let pinch: { distance: number; zoom: number; world: Point } | null = null;
    let spaceHeld = false;
    let nextPosition: { id: string; x: number; y: number } | null = null;
    let nextGroup: { ids: string[]; dx: number; dy: number } | null = null;
    let nextMarquee: Rect | null = null;
    let frame = 0;
    const commitPosition = () => {
      frame = 0;
      setDragPosition(nextPosition);
      setGroupDrag(nextGroup);
      setMarquee(nextMarquee);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(commitPosition);
    };
    function finishGroup(ids: string[], offset: { dx: number; dy: number }, dropY?: number) {
      const moved = new Set(ids);
      latest.current.update(draft => {
        draft.cards.forEach(card => {
          if (!moved.has(card.id)) return;
          card.x += offset.dx;
          card.y += offset.dy;
        });
      });
      if (droppedOnTimeline(dropY)) {
        const cards = latest.current.projectRef.current.cards.filter(card => moved.has(card.id));
        latest.current.addToSequence(visualOrder(cards).map(card => card.id));
      }
    }
    function selectInBox(box: Rect) {
      const c = camera.get();
      const world = {
        left: (box.left - c.x) / c.zoom,
        top: (box.top - c.y) / c.zoom,
        width: box.width / c.zoom,
        height: box.height / c.zoom,
      };
      selectionRef.current.add(cardsInRect(latest.current.projectRef.current.cards, world));
    }
    function droppedOnTimeline(dropY?: number) {
      const timeline = viewport.parentElement
        ?.querySelector('.fo-timeline')
        ?.getBoundingClientRect();
      return Boolean(
        timeline && dropY !== undefined && dropY >= timeline.top && dropY <= timeline.bottom,
      );
    }
    function finish(cancelled = false, dropY?: number) {
      if (!drag) return;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (drag.kind === 'card' && drag.group && !cancelled) {
        // A plain click on one card of a group selects just that card.
        if (!drag.moved && drag.id) selectionRef.current.select(drag.id);
        else if (drag.moved && nextGroup) finishGroup(drag.group, nextGroup, dropY);
      } else if (drag.kind === 'card' && drag.id && drag.moved && !cancelled && nextPosition) {
        const final = nextPosition;
        const id = drag.id;
        latest.current.update(draft => {
          const card = draft.cards.find(c => c.id === id);
          if (card) {
            card.x = final.x;
            card.y = final.y;
          }
        });
        if (droppedOnTimeline(dropY)) latest.current.addToSequence(id);
      }
      if (drag.kind === 'marquee' && drag.moved && !cancelled && nextMarquee)
        selectInBox(nextMarquee);
      if (drag.moved) suppressUntil.current = performance.now() + 300;
      nextPosition = null;
      nextGroup = null;
      nextMarquee = null;
      setDragPosition(null);
      setGroupDrag(null);
      setMarquee(null);
      drag = null;
      setPanning(false);
    }
    function reset() {
      finish(true);
      pinch = null;
      const oldCaptures = [...captures.entries()];
      pointers.clear();
      captures.clear();
      oldCaptures.forEach(([id, element]) => {
        if (element.hasPointerCapture?.(id)) element.releasePointerCapture(id);
      });
      camera.cancel();
      camera.flush();
      spaceHeld = false;
      setSpace(false);
      setPanning(false);
      setFileDrop(false);
      latest.current.update(draft => {
        draft.camera = camera.get();
      }, false);
    }
    cancelGesture.current = reset;
    function beginPinch() {
      finish(false);
      camera.cancel();
      const [a, b] = [...pointers.values()];
      const point = viewportPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      const c = camera.get();
      pinch = {
        distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        zoom: c.zoom,
        world: { x: (point.x - c.x) / c.zoom, y: (point.y - c.y) / c.zoom },
      };
      suppressUntil.current = performance.now() + 300;
      setPanning(true);
    }
    const wheel = (event: WheelEvent) => {
      if (latest.current.active === false) return;
      if ((event.target as Element).closest(blocked)) return;
      event.preventDefault();
      if (pointers.size) return;
      const { dx, dy } = normalizeWheel(event, viewport.clientHeight);
      if (event.ctrlKey || event.metaKey)
        camera.zoomBy(Math.exp(-dy * 0.002), viewportPoint(event.clientX, event.clientY));
      else camera.pan(-(event.shiftKey && !dx ? dy : dx), event.shiftKey && !dx ? 0 : -dy);
    };
    const down = (event: PointerEvent) => {
      if (latest.current.active === false) return;
      if (![0, 1].includes(event.button) || (event.target as Element).closest(ownInput)) return;
      camera.cancel();
      event.preventDefault();
      const target = event.target as Element;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      try {
        target.setPointerCapture(event.pointerId);
        captures.set(event.pointerId, target);
      } catch {
        /* synthetic events may not have active pointers */
      }
      if (pointers.size >= 2) {
        beginPinch();
        return;
      }
      const id = target.closest<HTMLElement>('.fo-card')?.dataset.id;
      const card = latest.current.projectRef.current.cards.find(c => c.id === id);
      const hand = spaceHeld || toolRef.current === 'hand' || event.button === 1;
      if (card && !hand && event.shiftKey) {
        selectionRef.current.toggle(card.id);
        // Swallow the click that follows, which would select this card alone.
        suppressUntil.current = performance.now() + 300;
      } else if (card && !hand) {
        const { ids } = selectionRef.current;
        const group = ids.includes(card.id) ? ids : undefined;
        if (!group) selectionRef.current.select(card.id);
        drag = {
          kind: 'card',
          pointerId: event.pointerId,
          id: card.id,
          group,
          start: { x: event.clientX, y: event.clientY },
          origin: { x: card.x, y: card.y },
          moved: false,
        };
      } else if (!hand && event.shiftKey) {
        drag = {
          kind: 'marquee',
          pointerId: event.pointerId,
          start: { x: event.clientX, y: event.clientY },
          origin: viewportPoint(event.clientX, event.clientY),
          moved: false,
        };
      } else {
        if (!hand) selectionRef.current.select(null);
        const current = camera.get();
        drag = {
          kind: 'camera',
          pointerId: event.pointerId,
          start: { x: event.clientX, y: event.clientY },
          origin: { x: current.x, y: current.y },
          moved: false,
        };
        setPanning(true);
      }
    };
    const move = (event: PointerEvent) => {
      if (latest.current.active === false) return;
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const point = viewportPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
        const zoom = clamp(
          (pinch.zoom * Math.hypot(b.x - a.x, b.y - a.y)) / pinch.distance,
          0.15,
          4,
        );
        camera.set({ zoom, x: point.x - pinch.world.x * zoom, y: point.y - pinch.world.y * zoom });
        return;
      }
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.start.x;
      const dy = event.clientY - drag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.kind === 'camera')
        camera.set({ ...camera.get(), x: drag.origin.x + dx, y: drag.origin.y + dy });
      else if (drag.kind === 'marquee') {
        nextMarquee = rectBetween(drag.origin, viewportPoint(event.clientX, event.clientY));
        schedule();
      } else if (drag.group) {
        const zoom = camera.get().zoom;
        nextGroup = { ids: drag.group, dx: dx / zoom, dy: dy / zoom };
        schedule();
      } else if (drag.id) {
        nextPosition = {
          id: drag.id,
          x: drag.origin.x + dx / camera.get().zoom,
          y: drag.origin.y + dy / camera.get().zoom,
        };
        schedule();
      }
    };
    const end = (event: PointerEvent) => {
      if (latest.current.active === false) return;
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      const target = captures.get(event.pointerId);
      captures.delete(event.pointerId);
      if (target?.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      if (pinch) {
        pinch = null;
        suppressUntil.current = performance.now() + 300;
        if (pointers.size >= 2) beginPinch();
        else if (pointers.size === 1) {
          const [id, point] = [...pointers.entries()][0];
          const current = camera.get();
          drag = {
            kind: 'camera',
            pointerId: id,
            start: point,
            origin: { x: current.x, y: current.y },
            moved: false,
          };
        } else setPanning(false);
      } else if (drag?.pointerId === event.pointerId)
        finish(event.type !== 'pointerup', event.clientY);
      camera.flush();
    };
    const click = (event: MouseEvent) => {
      if (
        latest.current.active !== false &&
        event.detail &&
        performance.now() < suppressUntil.current &&
        !(event.target as Element).closest(blocked)
      ) {
        event.stopPropagation();
        event.preventDefault();
      }
    };
    const doubleClick = (event: MouseEvent) => {
      if (
        latest.current.active !== false &&
        performance.now() >= suppressUntil.current &&
        !(event.target as Element).closest(`${ownInput},.fo-card`)
      )
        latest.current.onBackgroundDoubleClick();
    };
    const dragover = (event: DragEvent) => {
      if (latest.current.active !== false && event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
        setFileDrop(true);
      }
    };
    const dragleave = (event: DragEvent) => {
      if (latest.current.active === false) return;
      if (!(event.relatedTarget instanceof Node) || !viewport.contains(event.relatedTarget))
        setFileDrop(false);
    };
    const drop = (event: DragEvent) => {
      if (latest.current.active === false) return;
      setFileDrop(false);
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      latest.current.onFiles(event.dataTransfer.files, toWorld(event.clientX, event.clientY));
    };
    const keydown = (event: KeyboardEvent) => {
      if (latest.current.active === false) return;
      if (
        (event.target as Element)?.closest?.(
          'input,textarea,select,[role="combobox"],[contenteditable="true"]',
        ) ||
        document.querySelector('dialog[open]')
      )
        return;
      // Space activates a focused control. Only use it as the temporary hand
      // shortcut when focus is on the workspace itself.
      if (
        event.code === 'Space' &&
        (event.target as Element)?.closest?.('button,a,[role="button"]')
      )
        return;
      if (event.code === 'Space') {
        spaceHeld = true;
        setSpace(true);
        event.preventDefault();
      }
      if (event.key === 'Escape') {
        reset();
        selectionRef.current.clear();
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (latest.current.active !== false && event.code === 'Space') {
        spaceHeld = false;
        setSpace(false);
      }
    };
    const blur = () => {
      if (latest.current.active !== false) reset();
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    viewport.addEventListener('pointerdown', down);
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);
    viewport.addEventListener('lostpointercapture', end);
    viewport.addEventListener('click', click, true);
    viewport.addEventListener('dblclick', doubleClick);
    viewport.addEventListener('dragover', dragover);
    viewport.addEventListener('dragleave', dragleave);
    viewport.addEventListener('drop', drop);
    document.addEventListener('keydown', keydown);
    document.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      camera.destroy();
      controller.current = null;
      cancelGesture.current = () => {};
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('pointerdown', down);
      viewport.removeEventListener('pointermove', move);
      viewport.removeEventListener('pointerup', end);
      viewport.removeEventListener('pointercancel', end);
      viewport.removeEventListener('lostpointercapture', end);
      viewport.removeEventListener('click', click, true);
      viewport.removeEventListener('dblclick', doubleClick);
      viewport.removeEventListener('dragover', dragover);
      viewport.removeEventListener('dragleave', dragleave);
      viewport.removeEventListener('drop', drop);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  }, [toWorld, viewportPoint]);
  useEffect(() => {
    if (options.active === false) cancelActiveGesture();
  }, [options.active, cancelActiveGesture]);
  const grouped = useMemo(() => new Set(groupDrag?.ids), [groupDrag]);
  /** Where a card is drawn: its live position while it is being dragged. */
  const positionOf = (card: Card): { x: number; y: number } => {
    if (dragPosition?.id === card.id) return dragPosition;
    if (groupDrag && grouped.has(card.id))
      return { x: card.x + groupDrag.dx, y: card.y + groupDrag.dy };
    return card;
  };
  return {
    camera,
    tool,
    setTool,
    space,
    panning,
    fileDrop,
    dragPosition,
    positionOf,
    marquee,
    selection,
    fit,
    zoomBy,
    zoomTo,
    restoreCamera,
    cancelGesture: cancelActiveGesture,
  };
}
