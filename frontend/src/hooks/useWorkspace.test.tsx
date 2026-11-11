import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspace } from './useWorkspace';
import { CHECKPOINTS_STORAGE_KEY, initialState, STORAGE_KEY } from '../lib/project';
import { loadDesktopStorage } from '../lib/desktop-storage';

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
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function savedMedia() {
  const project = initialState();
  project.cards = [{ id: 'uploaded-frame', x: 20, y: 50, name: '已导入的首帧', kind: 'image', src: '', mediaId: 'media-1' }];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

describe('workspace persistence and asynchronous media loading', () => {
  it('keeps current edits when media loading finishes, including in StrictMode', async () => {
    savedMedia();
    let resolve!: (blob: Blob) => void;
    getMedia.mockReturnValue(new Promise<Blob>(done => { resolve = done; }));
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(useWorkspace, { wrapper });
    act(() => result.current.update(draft => { draft.title = '新的标题'; draft.cards[0].x = 999; }));
    await act(async () => { resolve(new Blob(['test'], { type: 'image/png' })); });
    expect(result.current.project.title).toBe('新的标题');
    expect(result.current.project.cards[0]).toMatchObject({ x: 999, src: 'blob:hydrated-media', missingMedia: false });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('does not lose restored media when undoing an edit made before its load completed', async () => {
    savedMedia();
    let resolve!: (blob: Blob) => void;
    getMedia.mockReturnValue(new Promise<Blob>(done => { resolve = done; }));
    const { result } = renderHook(useWorkspace);
    act(() => result.current.update(draft => { draft.title = '编辑期间'; }));
    await act(async () => { resolve(new Blob(['test'], { type: 'image/png' })); });
    expect(result.current.project.cards[0].missingMedia).toBe(false);
    await act(async () => result.current.undo());
    expect(result.current.project.title).toBe(initialState().title);
    expect(result.current.project.cards[0]).toMatchObject({ src: 'blob:hydrated-media', missingMedia: false });
  });

  it('does not reinsert a deleted card after its pending media lookup resolves', async () => {
    savedMedia();
    let resolve!: (blob: Blob) => void;
    getMedia.mockReturnValue(new Promise<Blob>(done => { resolve = done; }));
    const { result } = renderHook(useWorkspace);
    act(() => result.current.update(draft => { draft.cards = []; }));
    await act(async () => { resolve(new Blob(['test'], { type: 'image/png' })); });
    expect(result.current.project.cards).toEqual([]);
  });

  it('flushes the latest camera position when unmounting before the save debounce finishes', () => {
    const { result, unmount } = renderHook(useWorkspace);
    act(() => result.current.update(draft => { draft.camera = { x: 321, y: -456, zoom: 1.25 }; }, false));
    unmount();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).camera).toEqual({ x: 321, y: -456, zoom: 1.25 });
  });

  it('flushes the desktop workspace without waiting for the debounce timer', async () => {
    const files = new Map<string, ArrayBuffer>();
    vi.stubGlobal('frameoutDesktop', {
      storage: {
        read: async (key: string) => files.get(key) ?? null,
        write: async (key: string, bytes: ArrayBuffer) => { files.set(key, bytes); },
      },
      onBeforeClose: () => () => {},
    });
    await loadDesktopStorage();
    const { result } = renderHook(useWorkspace);
    act(() => result.current.update(draft => { draft.camera.x = 512; draft.title = '桌面项目'; }));
    await act(async () => result.current.flush());
    const saved = JSON.parse(new TextDecoder().decode(files.get(STORAGE_KEY)));
    expect(saved).toMatchObject({ title: '桌面项目', camera: { x: 512 } });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
  it('shares unchanged cards between edits and restores them on undo', () => {
    const project = initialState();
    project.cards = ['a', 'b'].map((id, index) => ({ id, x: index * 300, y: 0, name: id, kind: 'image' as const, src: `https://media.example/${id}.png` }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    const { result } = renderHook(useWorkspace);
    const [first, second] = result.current.project.cards;
    act(() => result.current.update(draft => { draft.cards[0].x = 50; }));
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
    const { result } = renderHook(useWorkspace);
    act(() => { vi.advanceTimersByTime(300); });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).not.toHaveProperty('checkpoints');
    expect(JSON.parse(localStorage.getItem(CHECKPOINTS_STORAGE_KEY)!)).toMatchObject([{ id: 'v1', name: '第一稿' }]);
    setItem.mockClear();
    act(() => result.current.update(draft => { draft.title = '改名'; }));
    act(() => { vi.advanceTimersByTime(300); });
    expect(setItem.mock.calls.map(([key]) => key)).toEqual([STORAGE_KEY]);
    setItem.mockClear();
    act(() => { result.current.createCheckpoint('第二稿'); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(setItem.mock.calls.map(([key]) => key)).toEqual([CHECKPOINTS_STORAGE_KEY]);
    cleanup();
    const reopened = renderHook(useWorkspace);
    expect(reopened.result.current.project.title).toBe('改名');
    expect(reopened.result.current.project.checkpoints!.map(item => item.name)).toEqual(['第一稿', '第二稿']);
  });
});
