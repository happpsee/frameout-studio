import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  askNotificationPermission,
  resetNotificationAsk,
  useCompletionNotice,
} from './useCompletionNotice';

let hidden = false;
let focused = true;
const shown: { title: string; body?: string }[] = [];
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
  onclick: (() => void) | null = null;
  constructor(title: string, options?: NotificationOptions) {
    shown.push({ title, body: options?.body });
  }
  close() {}
}

function setVisible(visible: boolean) {
  hidden = !visible;
  focused = visible;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  hidden = false;
  focused = true;
  shown.length = 0;
  document.title = '创作画布 — 帧外 FRAMEOUT';
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal('Notification', FakeNotification);
  localStorage.clear();
  resetNotificationAsk();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useCompletionNotice', () => {
  it('stays quiet while the user is looking at the page', () => {
    const { result } = renderHook(() => useCompletionNotice());
    act(() => result.current('succeeded', '图片已加入画布'));
    expect(document.title).toBe('创作画布 — 帧外 FRAMEOUT');
    expect(shown).toEqual([]);
  });

  it('marks the title and notifies while hidden, then restores the title on return', () => {
    const { result } = renderHook(() => useCompletionNotice());
    setVisible(false);
    act(() => result.current('succeeded', '视频已加入画布'));
    expect(document.title).toBe('✓ 生成完成 · 帧外');
    expect(shown).toEqual([{ title: '✓ 生成完成 · 帧外', body: '视频已加入画布' }]);
    act(() => result.current('failed', '请求超时'));
    expect(document.title).toBe('生成失败 · 帧外');
    setVisible(true);
    expect(document.title).toBe('创作画布 — 帧外 FRAMEOUT');
  });

  it('changes only the title when notifications are not allowed or not supported', () => {
    FakeNotification.permission = 'denied';
    const { result } = renderHook(() => useCompletionNotice());
    setVisible(false);
    act(() => result.current('failed', '被拒绝'));
    expect(document.title).toBe('生成失败 · 帧外');
    expect(shown).toEqual([]);
    vi.stubGlobal('Notification', undefined);
    act(() => result.current('succeeded', '好了'));
    expect(document.title).toBe('✓ 生成完成 · 帧外');
  });
});

describe('askNotificationPermission', () => {
  it('asks once, only while the choice is still open', () => {
    FakeNotification.permission = 'default';
    askNotificationPermission();
    askNotificationPermission();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    resetNotificationAsk();
    askNotificationPermission();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('does nothing without the Notification API or after a decision', () => {
    FakeNotification.permission = 'denied';
    askNotificationPermission();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    resetNotificationAsk();
    vi.stubGlobal('Notification', undefined);
    expect(() => askNotificationPermission()).not.toThrow();
  });
});
