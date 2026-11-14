import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportDialog from './ExportDialog';

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
  it('names the download after the project and the time of export', async () => {
    const user = userEvent.setup();
    render(<ExportDialog shots={shots} skipped={0} title="第1集/预告" onClose={() => {}} />);
    expect(screen.getByText('最后一步')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '开始导出' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('第1集-预告-成片-20261113-2107.mp4');
    expect(downloads).toEqual(['第1集-预告-成片-20261113-2107.mp4']);
  });
});
