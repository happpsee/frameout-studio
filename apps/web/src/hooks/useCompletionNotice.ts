import { useCallback, useEffect, useRef } from 'react';

export type CompletionOutcome = 'succeeded' | 'failed';
const TITLES: Record<CompletionOutcome, string> = {
  succeeded: '✓ 生成完成 · 帧外',
  failed: '生成失败 · 帧外',
};
const ASKED_KEY = 'frameout.notification-asked';
let askedThisPage = false;

function notificationApi(): typeof Notification | undefined {
  return typeof Notification === 'undefined' ? undefined : Notification;
}
function away() {
  return document.hidden || !document.hasFocus();
}

/**
 * Asks once for permission to show system notifications. Call it from a user action that
 * starts a long wait (a video generation), never on load.
 */
export function askNotificationPermission() {
  const api = notificationApi();
  if (askedThisPage || !api || api.permission !== 'default') return;
  askedThisPage = true;
  try {
    if (localStorage.getItem(ASKED_KEY)) return;
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* Storage is optional: still ask, at most once per page. */
  }
  try {
    void Promise.resolve(api.requestPermission()).catch(() => {});
  } catch {
    /* Some browsers only support the callback form or refuse outside a click. */
  }
}

/** Tells someone who switched away that a generation finished: tab title, plus a system notification when allowed. */
export function useCompletionNotice() {
  const savedTitle = useRef<string | null>(null);
  const restore = useCallback(() => {
    if (savedTitle.current === null) return;
    document.title = savedTitle.current;
    savedTitle.current = null;
  }, []);
  useEffect(() => {
    const back = () => {
      if (!away()) restore();
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
      restore();
    };
  }, [restore]);
  return useCallback((outcome: CompletionOutcome, body: string) => {
    if (!away()) return;
    if (savedTitle.current === null) savedTitle.current = document.title;
    document.title = TITLES[outcome];
    const api = notificationApi();
    if (api?.permission !== 'granted') return;
    try {
      const notice = new api(TITLES[outcome], { body: body.slice(0, 120), tag: 'frameout' });
      notice.onclick = () => {
        window.focus();
        notice.close();
      };
    } catch {
      /* Android Chrome only allows notifications from a service worker. */
    }
  }, []);
}

/** For tests: forget that permission was already asked on this page. */
export function resetNotificationAsk() {
  askedThisPage = false;
}
