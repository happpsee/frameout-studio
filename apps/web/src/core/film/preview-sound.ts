// Whether the sequence preview plays its video clips with sound. Remembered for this session
// only, so a new session starts with sound on again.

export const PREVIEW_MUTED_KEY = 'frameout-preview-muted';

export function loadPreviewMuted(): boolean {
  try {
    return sessionStorage.getItem(PREVIEW_MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function savePreviewMuted(muted: boolean): void {
  try {
    if (muted) sessionStorage.setItem(PREVIEW_MUTED_KEY, '1');
    else sessionStorage.removeItem(PREVIEW_MUTED_KEY);
  } catch {
    // Storage may be unavailable; the choice then lasts while the preview is open.
  }
}

/**
 * Plays a preview clip. If the browser refuses to start it with sound (autoplay rules), it is
 * muted and started again, and `onMuted` is told so the sound button shows the real state.
 */
export function playPreviewClip(element: HTMLMediaElement, onMuted: () => void): void {
  element.play().catch((error: unknown) => {
    if (element.muted || !(error instanceof Error) || error.name !== 'NotAllowedError') return;
    element.muted = true;
    onMuted();
    element.play().catch(() => {});
  });
}
