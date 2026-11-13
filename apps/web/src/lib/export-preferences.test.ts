import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPORT_PREFERENCES_KEY, loadDesktopStorage } from './desktop-storage';
import { exportFileName, loadExportPreferences, saveExportPreferences } from './export-preferences';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('export file name', () => {
  const date = new Date(2026, 10, 3, 9, 5);

  it('names the file after the project and the export time', () => {
    expect(exportFileName('森林来信', date)).toBe('森林来信-成片-20261103-0905.mp4');
  });

  it('replaces characters that file systems reject and trims stray dots and spaces', () => {
    expect(exportFileName(' 第1集: 上/下 "预告"? ', date)).toBe(
      '第1集- 上-下 -预告--成片-20261103-0905.mp4',
    );
    expect(exportFileName('a\u0007b', date)).toBe('a-b-成片-20261103-0905.mp4');
    expect(exportFileName('...', date)).toBe('帧外-成片-20261103-0905.mp4');
  });

  it('keeps long titles to a reasonable length', () => {
    const name = exportFileName('长'.repeat(200), date);
    expect(name).toBe(`${'长'.repeat(80)}-成片-20261103-0905.mp4`);
  });
});

describe('remembered export choice', () => {
  it('defaults to 16:9 at 1080p and remembers the last choice in the browser', () => {
    expect(loadExportPreferences()).toEqual({ ratio: '16:9', quality: '1080p' });
    saveExportPreferences({ ratio: '9:16', quality: '720p' });
    expect(loadExportPreferences()).toEqual({ ratio: '9:16', quality: '720p' });
  });

  it('ignores values it does not recognise', () => {
    localStorage.setItem(EXPORT_PREFERENCES_KEY, JSON.stringify({ ratio: '4:3', quality: '720p' }));
    expect(loadExportPreferences()).toEqual({ ratio: '16:9', quality: '720p' });
    localStorage.setItem(EXPORT_PREFERENCES_KEY, '{broken');
    expect(loadExportPreferences()).toEqual({ ratio: '16:9', quality: '1080p' });
  });

  it('is saved to and loaded from the desktop data files', async () => {
    const files = new Map<string, ArrayBuffer>();
    const storage = {
      read: vi.fn(async (key: string) => files.get(key) ?? null),
      write: vi.fn(async (key: string, value: ArrayBuffer) => {
        files.set(key, value);
      }),
    };
    vi.stubGlobal('frameoutDesktop', { storage, onBeforeClose: () => () => {} });
    await loadDesktopStorage();
    saveExportPreferences({ ratio: '1:1', quality: '720p' });
    await vi.waitFor(() => expect(files.has(EXPORT_PREFERENCES_KEY)).toBe(true));
    expect(localStorage.getItem(EXPORT_PREFERENCES_KEY)).toBeNull();
    await loadDesktopStorage();
    expect(loadExportPreferences()).toEqual({ ratio: '1:1', quality: '720p' });
  });
});
