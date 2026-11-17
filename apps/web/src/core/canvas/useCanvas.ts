import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import type { ReactFlowInstance } from '@xyflow/react';
import type { Camera, ProjectState, UpdateProject } from '../../types';
import { NOTE_HEIGHT, NOTE_WIDTH } from './notes';
import { CARD_HEIGHT, CARD_WIDTH, clamp } from './canvas-camera';
import { visualOrder } from './canvas-selection';
import { useMultiSelection } from './useMultiSelection';
import { useClipboardImport } from './useClipboardImport';
import { FILM_HEIGHT, FILM_ID, FILM_WIDTH, filmPosition } from './film-node';

type Point = { x: number; y: number };
type Options = {
  active?: boolean;
  viewportRef: RefObject<HTMLElement | null>;
  projectRef: RefObject<ProjectState>;
  update: UpdateProject;
  addToSequence: (ids: string | string[]) => void;
  onFiles: (files: FileList, position?: Point) => void;
  onBackgroundDoubleClick: () => void;
};
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;
const ANIMATION_MS = 220;

/**
 * The canvas around React Flow: the camera the rest of the studio reads, zoom commands, the
 * selection, and what React Flow does not do itself (file drops, the timeline drop, Space).
 * Panning, zooming, dragging and box selection are React Flow's (see FlowStage).
 */
export function useCanvas(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const flow = useRef<Pick<
    ReactFlowInstance,
    'getViewport' | 'setViewport' | 'screenToFlowPosition'
  > | null>(null);
  const [camera, setCamera] = useState<Camera>(options.projectRef.current.camera);
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const [fileDrop, setFileDrop] = useState(false);
  /** Clicks right after a drag belong to the drag, not to the card under the pointer. */
  const suppressUntil = useRef(0);
  const selection = useMultiSelection({ projectRef: options.projectRef, update: options.update });
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useClipboardImport(latest);
  const live = () => latest.current.active !== false;

  const go = useCallback((value: Camera, animate: boolean) => {
    if (!flow.current) setCamera(value);
    void flow.current?.setViewport(value, animate ? { duration: ANIMATION_MS } : undefined);
  }, []);
  const restoreCamera = useCallback((value: Camera) => go(value, false), [go]);
  const viewportPoint = useCallback((x?: number, y?: number) => {
    const rect = latest.current.viewportRef.current?.getBoundingClientRect();
    return {
      x: x === undefined ? (rect?.width ?? 800) / 2 : x - (rect?.left ?? 0),
      y: y === undefined ? Math.max(80, (rect?.height ?? 600) / 2 - 60) : y - (rect?.top ?? 0),
    };
  }, []);
  const zoomAround = useCallback(
    (zoom: number, point: Point, animate: boolean) => {
      const current = flow.current?.getViewport() ?? latest.current.projectRef.current.camera;
      const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
      const world = {
        x: (point.x - current.x) / current.zoom,
        y: (point.y - current.y) / current.zoom,
      };
      go({ zoom: next, x: point.x - world.x * next, y: point.y - world.y * next }, animate);
    },
    [go],
  );
  const zoomBy = useCallback(
    (factor: number, x?: number, y?: number, animate = true) => {
      if (!live()) return;
      const current = flow.current?.getViewport() ?? latest.current.projectRef.current.camera;
      zoomAround(current.zoom * factor, viewportPoint(x, y), animate);
    },
    [viewportPoint, zoomAround],
  );
  const zoomTo = useCallback(
    (value: number) => {
      if (live()) zoomAround(value / 100, viewportPoint(), true);
    },
    [viewportPoint, zoomAround],
  );
  const fit = useCallback(
    (animate = true) => {
      if (!live()) return;
      const viewport = latest.current.viewportRef.current;
      if (!viewport?.clientWidth) return;
      const project = latest.current.projectRef.current;
      const { cards, notes = [] } = project;
      const film = filmPosition(project);
      const boxes = [
        ...cards.map(c => ({ x: c.x, y: c.y, right: c.x + CARD_WIDTH, bottom: c.y + CARD_HEIGHT })),
        ...notes.map(n => ({ x: n.x, y: n.y, right: n.x + NOTE_WIDTH, bottom: n.y + NOTE_HEIGHT })),
        ...(cards.length
          ? [{ ...film, right: film.x + FILM_WIDTH, bottom: film.y + FILM_HEIGHT }]
          : []),
      ];
      if (!boxes.length) return go({ x: 60, y: 20, zoom: 0.8 }, animate);
      const left = Math.min(...boxes.map(box => box.x));
      const top = Math.min(...boxes.map(box => box.y));
      const width = Math.max(...boxes.map(box => box.right)) - left;
      const height = Math.max(...boxes.map(box => box.bottom)) - top;
      const safeLeft = viewport.clientWidth < 600 ? 68 : 95;
      const availableWidth = Math.max(100, viewport.clientWidth - safeLeft - 24);
      const availableHeight = Math.max(100, viewport.clientHeight - 245);
      const zoom = clamp(
        Math.min(availableWidth / (width + 60), availableHeight / (height + 60)),
        MIN_ZOOM,
        1.5,
      );
      go(
        {
          zoom,
          x: safeLeft + (availableWidth - width * zoom) / 2 - left * zoom,
          y: 60 + (availableHeight - height * zoom) / 2 - top * zoom,
        },
        animate,
      );
    },
    [go],
  );

  /** Moved cards are saved once, when the drag ends; dropped on the timeline, they join the cut. */
  const finishDrag = useCallback((moved: { id: string; x: number; y: number }[], dropY: number) => {
    if (!moved.length) return;
    suppressUntil.current = performance.now() + 300;
    const positions = new Map(moved.map(item => [item.id, item]));
    latest.current.update(draft => {
      draft.cards.forEach(card => {
        const next = positions.get(card.id);
        if (next) Object.assign(card, { x: next.x, y: next.y });
      });
      const film = positions.get(FILM_ID);
      if (film) draft.film = { x: film.x, y: film.y };
    });
    const timeline = latest.current.viewportRef.current?.parentElement
      ?.querySelector('.fo-timeline')
      ?.getBoundingClientRect();
    if (timeline && dropY >= timeline.top && dropY <= timeline.bottom) {
      const cards = latest.current.projectRef.current.cards.filter(card => positions.has(card.id));
      latest.current.addToSequence(visualOrder(cards).map(card => card.id));
    }
  }, []);
  const cameraMoved = useCallback((value: Camera) => {
    // Read synchronously by pagehide/export while the saved project state is debounced.
    latest.current.projectRef.current = { ...latest.current.projectRef.current, camera: value };
    setCamera(value);
  }, []);
  const cameraRested = useCallback((value: Camera) => {
    setPanning(false);
    latest.current.update(draft => {
      draft.camera = value;
    }, false);
  }, []);

  useEffect(() => {
    const viewport = latest.current.viewportRef.current;
    if (!viewport) return;
    const listeners = new AbortController();
    const { signal } = listeners;
    viewport.addEventListener(
      'click',
      event => {
        if (live() && event.detail && performance.now() < suppressUntil.current) {
          event.stopPropagation();
          event.preventDefault();
        }
      },
      { capture: true, signal },
    );
    viewport.addEventListener(
      'dblclick',
      event => {
        const target = event.target as Element;
        // Only empty canvas: lines, their labels and cards handle their own double-clicks.
        if (
          live() &&
          target.closest('.react-flow__pane') &&
          !target.closest('.react-flow__edge,.react-flow__node,.fo-link-label')
        )
          latest.current.onBackgroundDoubleClick();
      },
      { signal },
    );
    viewport.addEventListener(
      'dragover',
      event => {
        if (live() && event.dataTransfer?.types.includes('Files')) {
          event.preventDefault();
          setFileDrop(true);
        }
      },
      { signal },
    );
    viewport.addEventListener(
      'dragleave',
      event => {
        if (!(event.relatedTarget instanceof Node) || !viewport.contains(event.relatedTarget))
          setFileDrop(false);
      },
      { signal },
    );
    viewport.addEventListener(
      'drop',
      event => {
        setFileDrop(false);
        if (!live() || !event.dataTransfer?.files.length) return;
        event.preventDefault();
        const point = flow.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        latest.current.onFiles(event.dataTransfer.files, point);
      },
      { signal },
    );
    return () => listeners.abort();
  }, []);

  const keysOn = options.active !== false;
  const typing = (event: KeyboardEvent) =>
    Boolean(
      (event.target as Element)?.closest?.(
        'input,textarea,select,[role="combobox"],[contenteditable="true"]',
      ) || document.querySelector('dialog[open]'),
    );
  // Space shows the hand; React Flow pans while it is held (panActivationKeyCode).
  useHotkeys('space', event => setSpace(event.type === 'keydown'), {
    enabled: keysOn,
    keydown: true,
    keyup: true,
    enableOnFormTags: true,
    enableOnContentEditable: true,
    ignoreEventWhen: event =>
      event.type === 'keydown' &&
      (typing(event) || Boolean((event.target as Element)?.closest?.('button,a,[role="button"]'))),
  });
  useHotkeys('escape', () => selectionRef.current.clear(), {
    enabled: keysOn,
    ignoreEventWhen: typing,
  });
  const cancelGesture = useCallback(() => {
    setPanning(false);
    setSpace(false);
    setFileDrop(false);
  }, []);
  useEffect(() => {
    if (options.active === false) cancelGesture();
  }, [options.active, cancelGesture]);
  return {
    camera,
    tool,
    setTool,
    space,
    panning,
    setPanning,
    fileDrop,
    selection,
    fit,
    zoomBy,
    zoomTo,
    restoreCamera,
    cancelGesture,
    /** For FlowStage only. */
    flow: { instance: flow, finishDrag, cameraMoved, cameraRested },
  };
}
export type Canvas = ReturnType<typeof useCanvas>;
