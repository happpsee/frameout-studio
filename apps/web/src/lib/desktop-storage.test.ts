import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GENERATION_MODE_KEY,
  PROJECT_STORAGE_KEY,
  flushDesktopStorage,
  loadDesktopKeys,
  loadDesktopStorage,
  readStoredValue,
  removeStoredValue,
  writeStoredValue,
} from './desktop-storage';
import { DesktopMediaTooLargeError, getMedia, putMedia } from './media-store';

const bytes = (value: string) => new TextEncoder().encode(value).buffer;
const files = new Map<string, ArrayBuffer>();
const read = vi.fn(async (key: string) => files.get(key) ?? null);
const write = vi.fn(async (key: string, value: ArrayBuffer) => {
  files.set(key, value);
});

beforeEach(() => {
  files.clear();
  vi.stubGlobal('frameoutDesktop', { storage: { read, write }, onBeforeClose: () => () => {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('desktop data files', () => {
  it('loads the saved project and preferences before the workspace mounts', async () => {
    const project = JSON.stringify({
      version: 1,
      title: '已保存的项目',
      cards: [],
      sequence: [],
      camera: { x: 40, y: -20, zoom: 1.5 },
    });
    files.set(PROJECT_STORAGE_KEY, bytes(project));
    files.set(GENERATION_MODE_KEY, bytes('video'));
    await loadDesktopStorage();
    expect(readStoredValue(PROJECT_STORAGE_KEY)).toBe(project);
    expect(readStoredValue(GENERATION_MODE_KEY)).toBe('video');
    expect(write).not.toHaveBeenCalled();
  });

  it('starts with a damaged pre-project workspace and leaves the file alone', async () => {
    files.set(PROJECT_STORAGE_KEY, bytes('{damaged'));
    await loadDesktopStorage();
    expect(readStoredValue(PROJECT_STORAGE_KEY)).toBe('{damaged');
    expect(write).not.toHaveBeenCalled();
  });

  it('loads other keys on demand, keeps newer writes and refuses a damaged value', async () => {
    files.set('frameout-project-a', bytes('saved-a'));
    files.set('frameout-project-b', bytes('saved-b'));
    files.set('frameout-project-bad', bytes('{damaged'));
    await loadDesktopStorage();
    expect(readStoredValue('frameout-project-a')).toBeNull();
    void writeStoredValue('frameout-project-b', 'newer-b');
    await loadDesktopKeys(['frameout-project-a', 'frameout-project-b', 'frameout-project-none']);
    expect(readStoredValue('frameout-project-a')).toBe('saved-a');
    expect(readStoredValue('frameout-project-b')).toBe('newer-b');
    expect(readStoredValue('frameout-project-none')).toBeNull();
    const check = (_key: string, value: string) => void JSON.parse(value);
    await expect(loadDesktopKeys(['frameout-project-bad'], check)).rejects.toThrow();
    expect(readStoredValue('frameout-project-bad')).toBeNull();
    await flushDesktopStorage();
    expect(new TextDecoder().decode(files.get('frameout-project-bad'))).toBe('{damaged');
  });

  it('removes a value by emptying its file, and can hold a write until another finishes', async () => {
    await loadDesktopStorage();
    let finish!: () => void;
    const first = new Promise<void>(resolve => (finish = resolve));
    const index = writeStoredValue('frameout-projects-v1', 'index', first);
    expect(readStoredValue('frameout-projects-v1')).toBe('index');
    await Promise.resolve();
    await Promise.resolve();
    expect(files.has('frameout-projects-v1')).toBe(false);
    finish();
    await index;
    expect(new TextDecoder().decode(files.get('frameout-projects-v1'))).toBe('index');
    await removeStoredValue('frameout-projects-v1');
    expect(readStoredValue('frameout-projects-v1')).toBeNull();
    expect(files.get('frameout-projects-v1')!.byteLength).toBe(0);
    await loadDesktopStorage();
    expect(readStoredValue('frameout-projects-v1')).toBeNull();
  });

  it('drains queued writes in order and leaves the latest snapshot on disk', async () => {
    let finishFirst!: () => void;
    write.mockImplementationOnce(
      (key, value) =>
        new Promise<void>(resolve => {
          finishFirst = () => {
            files.set(key, value);
            resolve();
          };
        }),
    );
    const first = writeStoredValue(PROJECT_STORAGE_KEY, 'older');
    const second = writeStoredValue(PROJECT_STORAGE_KEY, 'latest');
    const closing = flushDesktopStorage();
    await Promise.resolve();
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    finishFirst();
    await Promise.all([first, second, closing]);
    expect(new TextDecoder().decode(files.get(PROJECT_STORAGE_KEY))).toBe('latest');
  });

  it('restores the same media bytes and MIME type from a desktop file', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    const original = new Blob([Uint8Array.of(0, 1, 255, 100)], { type: 'video/mp4' });
    const id = await putMedia(original);
    expect(id).toMatch(/^media-/);
    expect(files.has(id)).toBe(true);
    const restored = await getMedia(id);
    expect(restored?.type).toBe('video/mp4');
    expect(await restored?.arrayBuffer()).toEqual(await original.arrayBuffer());
    expect(await getMedia('missing-media')).toBeNull();
  });

  it('rejects oversized media before converting it to an IPC buffer', async () => {
    const arrayBuffer = vi.fn();
    const oversized = {
      size: 100 * 1024 * 1024 + 1,
      type: 'video/mp4',
      arrayBuffer,
    } as unknown as Blob;
    await expect(putMedia(oversized)).rejects.toBeInstanceOf(DesktopMediaTooLargeError);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
