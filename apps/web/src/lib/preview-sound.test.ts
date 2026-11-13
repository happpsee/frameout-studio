import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadPreviewMuted,
  playPreviewClip,
  PREVIEW_MUTED_KEY,
  savePreviewMuted,
} from './preview-sound';

beforeEach(() => sessionStorage.clear());

describe('preview sound', () => {
  it('plays with sound by default and remembers muting for the session', () => {
    expect(loadPreviewMuted()).toBe(false);
    savePreviewMuted(true);
    expect(sessionStorage.getItem(PREVIEW_MUTED_KEY)).toBe('1');
    expect(loadPreviewMuted()).toBe(true);
    savePreviewMuted(false);
    expect(loadPreviewMuted()).toBe(false);
  });

  it('falls back to muted playback when the browser blocks sound', async () => {
    const blocked = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
    const play = vi.fn().mockRejectedValueOnce(blocked).mockResolvedValue(undefined);
    const element = { muted: false, play } as unknown as HTMLMediaElement;
    const onMuted = vi.fn();
    playPreviewClip(element, onMuted);
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(element.muted).toBe(true);
    expect(onMuted).toHaveBeenCalledOnce();
  });

  it('leaves other playback failures alone', async () => {
    const play = vi.fn().mockRejectedValue(new Error('aborted'));
    const element = { muted: false, play } as unknown as HTMLMediaElement;
    const onMuted = vi.fn();
    playPreviewClip(element, onMuted);
    await Promise.resolve();
    await Promise.resolve();
    expect(play).toHaveBeenCalledOnce();
    expect(element.muted).toBe(false);
    expect(onMuted).not.toHaveBeenCalled();
  });
});
