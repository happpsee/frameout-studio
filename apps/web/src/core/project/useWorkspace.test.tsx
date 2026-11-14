import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspace } from './useWorkspace';
import { initialState } from './project';
import { loadDesktopStorage } from './desktop-storage';
import { createProject, projectDataKeys } from './projects';
const TEST_PROJECT = 'test';
const STORAGE_KEY = projectDataKeys(TEST_PROJECT).project;

const { getMedia } = vi.hoisted(() => ({ getMedia: vi.fn() }));
vi.mock('./media-store', () => ({ getMedia }));
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
