// @vitest-environment jsdom
// Performance baseline for a large project. Run with `npm run bench`; it is excluded from `npm test`.
import { Profiler, StrictMode } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, it, vi } from 'vitest';
import Studio from '../components/Studio';
import { useWorkspace } from '../hooks/useWorkspace';
import { initialState, serializeProject, serializeWorkspace, STORAGE_KEY } from '../lib/project';
import type { Card, ProjectState } from '../types';

const CARDS = 200;
const results: Record<string, string> = {};

function largeProject(): ProjectState {
  const project = initialState();
  project.cards = Array.from({ length: CARDS }, (_, index): Card => ({
    id: `card-${index}`,
    x: (index % 20) * 310,
    y: Math.floor(index / 20) * 260,
    name: `镜头 ${index}`,
    src: `https://media.example/shot-${index}.png`,
    kind: 'image',
    provider: 'ark',
    label: 'AI 生成图片',
    prompt: '清晨的森林，薄雾穿过树干，一位宇航员站在光里，电影感，35mm 胶片颗粒'.repeat(3),
    size: '2K',
  }));
  project.sequence = project.cards
    .slice(0, 30)
    .map((card, index) => ({ id: `shot-${index}`, cardId: card.id, duration: 4 }));
  project.checkpoints = Array.from({ length: 8 }, (_, index) => ({
    id: `cp-${index}`,
    name: `版本 ${index}`,
    createdAt: index,
    state: serializeWorkspace(project),
  }));
  project.workflow = {
    id: 'wf',
    status: 'paused',
    createdAt: 0,
    config: {
      provider: 'ark',
      baseUrl: '',
      imageModel: 'm',
      videoModel: 'v',
      imageSize: '2K',
      duration: 5,
      videoRatio: '16:9',
      resolution: '720p',
      transport: 'proxy',
    },
    steps: Array.from({ length: 16 }, (_, index) => ({
      id: `step-${index}`,
      prompt: '镜头描述',
      mode: 'image' as const,
      status: 'succeeded' as const,
    })),
    events: Array.from({ length: 160 }, (_, index) => ({
      id: `ev-${index}`,
      at: index,
      message: `步骤 ${index} 已完成`,
    })),
  };
  return project;
}

function time(run: () => void, repeat: number) {
  run();
  const start = performance.now();
  for (let index = 0; index < repeat; index++) run();
  return (performance.now() - start) / repeat;
}

let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
function frame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(fn => fn(performance.now()));
  });
}
function pointer(target: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, clientX: x, clientY: y, button: 0, pointerType: 'mouse' });
  act(() => {
    target.dispatchEvent(event);
  });
}

beforeEach(() => {
  localStorage.clear();
  frames.clear();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeProject(largeProject())));
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++frameId, fn);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1200,
    bottom: 800,
    width: 1200,
    height: 800,
    toJSON: () => ({}),
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(() => {
  console.table(results);
});

describe(`workspace with ${CARDS} cards, 8 versions and a 160-event plan`, () => {
  it('measures one recorded edit', () => {
    const { result } = renderHook(useWorkspace);
    let x = 0;
    const ms = time(
      () =>
        act(() =>
          result.current.update(draft => {
            draft.cards[0].x = ++x;
          }),
        ),
      50,
    );
    results['edit (update) ms'] = ms.toFixed(2);
  });

  it('measures one autosave serialization', () => {
    // An edit autosaves the project; versions are stored separately and only rewritten when they change.
    const project = largeProject();
    let bytes = 0;
    const ms = time(() => {
      bytes = JSON.stringify(serializeProject({ ...project, checkpoints: undefined })).length;
    }, 50);
    results['autosave serialize ms'] = ms.toFixed(2);
    results['autosave payload KB'] = (bytes / 1024).toFixed(0);
  });

  it('measures canvas renders while selecting and dragging a card', () => {
    let committed = 0;
    const view = render(
      <StrictMode>
        <Profiler
          id="studio"
          onRender={(_id, _phase, duration) => {
            committed += duration;
          }}
        >
          <Studio onClose={() => {}} />
        </Profiler>
      </StrictMode>,
    );
    frame();
    frame();
    results['cards in DOM'] = String(view.container.querySelectorAll('.fo-card').length);
    const media = (id: number) =>
      view.container.querySelector(`.fo-card[data-id="card-${id}"] .fo-media`)!;
    const select = (id: number) => {
      pointer(media(id), 'pointerdown', 100, 100);
      pointer(media(id), 'pointerup', 100, 100);
      frame();
    };
    // Warm up once, then average repeated interactions so JIT start-up does not dominate.
    [0, 1, 2].forEach(select);
    committed = 0;
    const selections = [3, 4, 5, 20, 21, 22, 23, 24, 25, 26];
    selections.forEach(select);
    results['select render ms'] = (committed / selections.length).toFixed(2);
    const card = media(0);
    pointer(card, 'pointerdown', 100, 100);
    for (let step = 1; step <= 10; step++) {
      pointer(card, 'pointermove', 100 + step * 5, 100 + step * 3);
      frame();
    }
    committed = 0;
    const moves = 30;
    for (let step = 11; step <= 10 + moves; step++) {
      pointer(card, 'pointermove', 100 + step * 5, 100 + step * 3);
      frame();
    }
    results['drag frame render ms'] = (committed / moves).toFixed(2);
    pointer(card, 'pointerup', 300, 220);
  });
});
