import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PreviewDialog from './PreviewDialog';
import { PREVIEW_MUTED_KEY } from '../lib/preview-sound';

const items = [
  {
    card: { id: 'v', x: 0, y: 0, name: '视频镜头', src: 'blob:clip', kind: 'video' as const },
    duration: 3,
  },
  {
    card: { id: 'i', x: 0, y: 0, name: '图片镜头', src: 'blob:still', kind: 'image' as const },
    duration: 2,
  },
];

beforeEach(() => {
  sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clip = () => document.querySelector('video')!;

describe('preview sound', () => {
  it('plays video clips with sound and remembers muting for the session', async () => {
    const user = userEvent.setup();
    render(<PreviewDialog items={items} title="森林来信" onClose={() => {}} />);
    expect(clip().muted).toBe(false);
    await user.click(screen.getByRole('button', { name: '关闭声音' }));
    expect(clip().muted).toBe(true);
    expect(sessionStorage.getItem(PREVIEW_MUTED_KEY)).toBe('1');
    cleanup();

    render(<PreviewDialog items={items} title="森林来信" onClose={() => {}} />);
    expect(clip().muted).toBe(true);
    await user.click(screen.getByRole('button', { name: '打开声音' }));
    expect(clip().muted).toBe(false);
  });
});
