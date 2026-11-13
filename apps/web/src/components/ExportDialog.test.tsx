import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EXPORT_PREFERENCES_KEY } from '../lib/desktop-storage';
import ExportDialog, { soundNote } from './ExportDialog';
import { exportSequence } from '../lib/export-video';

vi.mock('../lib/export-support', () => ({
  exportSupported: () => true,
  exportAudioSupported: () => true,
}));
vi.mock('../lib/export-video', () => ({
  exportSequence: vi.fn(async () => ({
    blob: new Blob(['video'], { type: 'video/mp4' }),
    audio: { kind: 'none' },
  })),
}));

const shots = [
  {
    card: { id: 'a', x: 0, y: 0, name: '镜头', src: 'blob:shot', kind: 'image' as const },
    duration: 3,
  },
];
let downloads: string[] = [];

beforeEach(() => {
  localStorage.clear();
  downloads = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 13, 21, 7));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
  URL.createObjectURL = () => 'blob:out';
  URL.revokeObjectURL = () => {};
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('export dialog', () => {
  it('opens with the ratio and quality chosen last time and remembers a new choice', async () => {
    localStorage.setItem(
      EXPORT_PREFERENCES_KEY,
      JSON.stringify({ ratio: '9:16', quality: '720p' }),
    );
    const user = userEvent.setup();
    render(<ExportDialog shots={shots} skipped={0} title="森林来信" onClose={() => {}} />);
    const ratio = screen.getByRole('combobox', { name: '导出画幅' });
    expect(ratio.textContent).toContain('9:16');
    expect(screen.getByRole('combobox', { name: '导出清晰度' }).textContent).toContain('720p');
    await user.click(ratio);
    await user.click(screen.getByRole('option', { name: '1:1' }));
    expect(JSON.parse(localStorage.getItem(EXPORT_PREFERENCES_KEY)!)).toEqual({
      ratio: '1:1',
      quality: '720p',
    });
  });

  it('names the download after the project and the time of export', async () => {
    const user = userEvent.setup();
    render(<ExportDialog shots={shots} skipped={0} title="第1集/预告" onClose={() => {}} />);
    expect(screen.getByText('最后一步')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '开始导出' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('第1集-预告-成片-20261113-2107.mp4');
    expect(downloads).toEqual(['第1集-预告-成片-20261113-2107.mp4']);
  });

  it("says the export keeps the clips' own sound", () => {
    render(<ExportDialog shots={shots} skipped={0} title="森林来信" onClose={() => {}} />);
    expect(screen.getByText(/会保留视频片段自带的声音/)).toBeTruthy();
    expect(screen.queryByText(/暂不包含声音/)).toBeNull();
  });

  it('tells plainly when the finished file has no sound', async () => {
    vi.mocked(exportSequence).mockResolvedValueOnce({
      blob: new Blob(['video'], { type: 'video/mp4' }),
      audio: { kind: 'unsupported' },
    });
    const user = userEvent.setup();
    render(<ExportDialog shots={shots} skipped={0} title="森林来信" onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: '开始导出' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('这个浏览器不能处理声音，成片没有声音');
  });
});

describe('export sound note', () => {
  it('only speaks up when sound is missing', () => {
    expect(soundNote({ kind: 'kept', silent: [] }, true)).toBe('');
    expect(soundNote({ kind: 'none' }, false)).toBe('');
    expect(soundNote({ kind: 'none' }, true)).toContain('都不带声音');
    expect(soundNote({ kind: 'kept', silent: ['镜头 2', '镜头 5'] }, true)).toBe(
      '镜头 2、镜头 5 的声音读不出来，这几段没有声音。',
    );
  });
});
