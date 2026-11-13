import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import BrowserStorageNotice, { BROWSER_NOTICE_KEY } from './BrowserStorageNotice';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('browser storage notice', () => {
  it('tells web users once that works live only in this browser', () => {
    render(<BrowserStorageNotice />);
    const notice = screen.getByRole('note', { name: '作品保存位置' });
    expect(notice.textContent).toContain('作品只存在这个浏览器里');
    expect(notice.textContent).toContain('及时下载');
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(localStorage.getItem(BROWSER_NOTICE_KEY)).toBe('dismissed');
    cleanup();
    render(<BrowserStorageNotice />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('stays hidden in the desktop app, which saves to disk', () => {
    vi.stubGlobal('frameoutDesktop', {
      storage: { read: async () => null, write: async () => {} },
      onBeforeClose: () => () => {},
    });
    render(<BrowserStorageNotice />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
