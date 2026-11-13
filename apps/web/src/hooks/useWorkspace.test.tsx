import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspace } from './useWorkspace';
import { initialState } from '../lib/project';
import { loadDesktopStorage } from '../lib/desktop-storage';
import { createProject, findProject, projectDataKeys, renameProject } from '../lib/projects';
const TEST_PROJECT = 'test';
const STORAGE_KEY = projectDataKeys(TEST_PROJECT).project;
const CHECKPOINTS_STORAGE_KEY = projectDataKeys(TEST_PROJECT).checkpoints;

const { getMedia } = vi.hoisted(() => ({ getMedia: vi.fn() }));
vi.mock('../lib/media-store', () => ({ getMedia }));
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  getMedia.mockReset();
  createObjectURL.mockReset().mockReturnValue('blob:hydrated-media');
  const NativeURL = URL;
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function savedMedia() {
  const project = initialState();
  project.cards = [
    {
      id: 'uploaded-frame',
      x: 20,
      y: 50,
      name: '已导入的首帧',
      kind: 'image',
      src: '',
      mediaId: 'media-1',
    },
  ];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

describe('workspace persistence and asynchronous media loading', () => {
  it('keeps current edits when media loading finishes, including in StrictMode', async () => {
    savedMedia();
    let resolve!: (blob: Blob) => void;
    getMedia.mockReturnValue(
      new Promise<Blob>(done => {
        resolve = done;
      }),
    );
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useWorkspace(TEST_PROJECT), { wrapper });
    act(() =>
      result.current.update(draft => {
        draft.title = '新的标题';
        draft.cards[0].x = 999;
      }),
    );
    await act(async () => {
      resolve(new Blob(['test'], { type: 'image/png' }));
    });
    expect(result.current.project.title).toBe('新的标题');
    expect(result.current.project.cards[0]).toMatchObject({
      x: 999,
      src: 'blob:hydrated-media',
      missingMedia: false,
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('does not lose restored media when undoing an edit made before its load completed', async () => {
    savedMedia();
    let resolve!: (blob: Blob) => void;
    getMedia.mockReturnValue(
      new Promise<Blob>(done => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() => useWorkspace(TEST_PROJECT));
    act(() =>
      result.current.update(draft => {
        draft.title = '编辑期间';
      }),
    );
    await act(async () => {
      resolve(new Blob(['test'], { type: 'image/png' }));
    });
    expect(result.current.project.cards[0].missingMedia).toBe(false);
    await act(async () => result.current.undo());
    expect(result.current.project.title).toBe(initialState().title);
    expect(result.current.project.cards[0]).toMatchObject({
      src: 'blob:hydrated-media',
      missingMedia: false,
    });
  });

  it('does not reinsert a deleted card after its pending media lookup resolves', async () => {
    savedMedia();
    let resolve!: (blob: Blob) => void;
    getMedia.mockReturnValue(
      new Promise<Blob>(done => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() => useWorkspace(TEST_PROJECT));
    act(() =>
      result.current.update(draft => {
        draft.cards = [];
      }),
    );
    await act(async () => {
      resolve(new Blob(['test'], { type: 'image/png' }));
    });
    expect(result.current.project.cards).toEqual([]);
  });

  it('flushes the latest camera position when unmounting before the save debounce finishes', () => {
    const { result, unmount } = renderHook(() => useWorkspace(TEST_PROJECT));
    act(() =>
      result.current.update(draft => {
        draft.camera = { x: 321, y: -456, zoom: 1.25 };
      }, false),
    );
    unmount();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).camera).toEqual({
      x: 321,
      y: -456,
      zoom: 1.25,
    });
  });

  it('flushes the desktop workspace without waiting for the debounce timer', async () => {
    const files = new Map<string, ArrayBuffer>();
    vi.stubGlobal('frameoutDesktop', {
      storage: {
        read: async (key: string) => files.get(key) ?? null,
        write: async (key: string, bytes: ArrayBuffer) => {
          files.set(key, bytes);
        },
      },
      onBeforeClose: () => () => {},
    });
    await loadDesktopStorage();
    const { result } = renderHook(() => useWorkspace(TEST_PROJECT));
    act(() =>
      result.current.update(draft => {
        draft.camera.x = 512;
        draft.title = '桌面项目';
      }),
    );
    await act(async () => result.current.flush());
    const saved = JSON.parse(new TextDecoder().decode(files.get(STORAGE_KEY)));
    expect(saved).toMatchObject({ title: '桌面项目', camera: { x: 512 } });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
  it('shares unchanged cards between edits and restores them on undo', () => {
    const project = initialState();
    project.cards = ['a', 'b'].map((id, index) => ({
      id,
      x: index * 300,
      y: 0,
      name: id,
      kind: 'image' as const,
      src: `https://media.example/${id}.png`,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    const { result } = renderHook(() => useWorkspace(TEST_PROJECT));
    const [first, second] = result.current.project.cards;
    act(() =>
      result.current.update(draft => {
        draft.cards[0].x = 50;
      }),
    );
    expect(result.current.project.cards[0]).not.toBe(first);
    expect(result.current.project.cards[1]).toBe(second);
    act(() => result.current.undo());
    expect(result.current.project.cards[0]).toBe(first);
    expect(result.current.project.cards[0].x).toBe(0);
  });
  it('moves versions out of the autosaved project and rewrites them only when they change', () => {
    const legacy = initialState();
    legacy.checkpoints = [{ id: 'v1', name: '第一稿', createdAt: 1, state: initialState() }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useWorkspace(TEST_PROJECT));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).not.toHaveProperty('checkpoints');
    expect(JSON.parse(localStorage.getItem(CHECKPOINTS_STORAGE_KEY)!)).toMatchObject([
      { id: 'v1', name: '第一稿' },
    ]);
    setItem.mockClear();
    act(() =>
      result.current.update(draft => {
        draft.title = '改名';
      }),
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(setItem.mock.calls.map(([key]) => key)).toEqual([STORAGE_KEY]);
    setItem.mockClear();
    act(() => {
      result.current.createCheckpoint('第二稿');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(setItem.mock.calls.map(([key]) => key)).toEqual([CHECKPOINTS_STORAGE_KEY]);
    cleanup();
    const reopened = renderHook(() => useWorkspace(TEST_PROJECT));
    expect(reopened.result.current.project.title).toBe('改名');
    expect(reopened.result.current.project.checkpoints!.map(item => item.name)).toEqual([
      '第一稿',
      '第二稿',
    ]);
  });
});

describe('project rename', () => {
  it('saves a trimmed name as one undo step and falls back when cleared', () => {
    const { result } = renderHook(() => useWorkspace(TEST_PROJECT));
    act(() => result.current.renameProject('  海边短片  '));
    expect(result.current.project.title).toBe('海边短片');
    expect(result.current.canUndo).toBe(true);
    act(() => vi.advanceTimersByTime(400));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).title).toBe('海边短片');
    act(() => result.current.renameProject(''));
    expect(result.current.project.title).toBe(initialState().title);
    act(() => result.current.undo());
    expect(result.current.project.title).toBe('海边短片');
    act(() => result.current.undo());
    expect(result.current.project.title).toBe(initialState().title);
  });

  it('records nothing when the name does not change', () => {
    const { result } = renderHook(() => useWorkspace(TEST_PROJECT));
    act(() => result.current.renameProject(` ${initialState().title} `));
    expect(result.current.canUndo).toBe(false);
  });
});

describe('one workspace per project', () => {
  const save = () => act(() => vi.advanceTimersByTime(400));

  it('loads and saves each project under its own keys', () => {
    const a = createProject('甲');
    const b = createProject('乙');
    const first = renderHook(() => useWorkspace(a.id));
    act(() =>
      first.result.current.update(draft => {
        draft.cards.push({
          id: 'a1',
          x: 0,
          y: 0,
          name: '甲的图',
          kind: 'image',
          src: 'https://a.example/1.png',
        });
      }),
    );
    save();
    first.unmount();
    const second = renderHook(() => useWorkspace(b.id));
    expect(second.result.current.project.title).toBe('乙');
    expect(second.result.current.project.cards).toEqual([]);
    expect(second.result.current.canUndo).toBe(false);
    second.unmount();
    expect(JSON.parse(localStorage.getItem(projectDataKeys(a.id).project)!).cards).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(projectDataKeys(b.id).project)!).cards).toEqual([]);
  });

  it('updates the list entry on save, moving it up only for content changes', () => {
    vi.setSystemTime(1000);
    const project = createProject('甲');
    vi.setSystemTime(50_000);
    const { result, unmount } = renderHook(() => useWorkspace(project.id));
    // Opening, panning and selecting are not changes to the project.
    act(() =>
      result.current.update(draft => {
        draft.camera = { x: 9, y: 9, zoom: 2 };
      }, false),
    );
    save();
    expect(findProject(project.id)?.updatedAt).toBe(1000);
    act(() =>
      result.current.update(draft => {
        draft.cards.push({
          id: 'c1',
          x: 0,
          y: 0,
          name: '图',
          kind: 'image',
          src: '/assets/still-city.webp',
        });
        draft.sequence.push({ id: 's1', cardId: 'c1', duration: 5 });
      }),
    );
    save();
    const changedAt = findProject(project.id)!.updatedAt;
    expect(changedAt).toBeGreaterThanOrEqual(50_000);
    expect(findProject(project.id)).toMatchObject({
      cardCount: 1,
      shotCount: 1,
      durationSeconds: 5,
      coverSrc: '/assets/still-city.webp',
      coverKind: 'image',
    });
    vi.setSystemTime(90_000);
    act(() => result.current.renameProject('改名'));
    save();
    expect(findProject(project.id)).toMatchObject({ title: '改名', updatedAt: changedAt });
    unmount();
    const reopened = renderHook(() => useWorkspace(project.id));
    save();
    reopened.unmount();
    expect(findProject(project.id)?.updatedAt).toBe(changedAt);
  });

  it('takes a rename made in the list, while open and while closed', () => {
    const project = createProject('旧名字');
    const { result, unmount } = renderHook(() => useWorkspace(project.id));
    act(() => renameProject(project.id, '列表里改的'));
    expect(result.current.project.title).toBe('列表里改的');
    expect(result.current.canUndo).toBe(false);
    save();
    expect(JSON.parse(localStorage.getItem(projectDataKeys(project.id).project)!).title).toBe(
      '列表里改的',
    );
    unmount();
    renameProject(project.id, '关着时改的');
    const reopened = renderHook(() => useWorkspace(project.id));
    expect(reopened.result.current.project.title).toBe('关着时改的');
  });

  it('keeps a copy of a project that cannot be read before autosave replaces it', () => {
    const project = createProject();
    const key = projectDataKeys(project.id).project;
    localStorage.setItem(key, '{damaged');
    const { result } = renderHook(() => useWorkspace(project.id));
    expect(result.current.project.cards).toEqual([]);
    save();
    expect(localStorage.getItem(key + '-damaged')).toBe('{damaged');
  });
});
