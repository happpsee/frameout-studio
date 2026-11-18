import { useEffect, useRef } from 'react';
import type { Card, SoundClip } from '../../types';

/** Further apart than this, a playing sound is moved back in step with the picture. */
const DRIFT = 0.25;

/** Whether the film is inside the clip at `time`. */
export const soundActive = (clip: SoundClip, time: number) =>
  time >= clip.at && time < clip.at + clip.length;

/**
 * Plays the film's sound track along with the preview: each clip has its own hidden audio
 * element, started, kept in step and stopped as the preview's clock passes through it.
 * Returns whether a clip that replaces the shots' own sound is playing now, so the preview
 * can silence the shot.
 */
export function usePreviewSounds(
  sounds: { clip: SoundClip; card: Card }[],
  time: number,
  playing: boolean,
  muted: boolean,
) {
  const players = useRef(new Map<string, HTMLAudioElement>());
  useEffect(() => {
    const current = players.current;
    return () => {
      current.forEach(audio => {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      });
      current.clear();
    };
  }, []);
  useEffect(() => {
    for (const { clip, card } of sounds) {
      let audio = players.current.get(clip.id);
      if (!audio) {
        audio = new Audio(card.src);
        audio.preload = 'auto';
        players.current.set(clip.id, audio);
      }
      audio.volume = clip.volume;
      if (!playing || muted || !soundActive(clip, time)) {
        if (!audio.paused) audio.pause();
        continue;
      }
      const target = clip.from + (time - clip.at);
      if (audio.paused || Math.abs(audio.currentTime - target) > DRIFT) audio.currentTime = target;
      if (audio.paused) audio.play().catch(() => {});
    }
  }, [sounds, time, playing, muted]);
  return sounds.some(({ clip }) => clip.mode === 'replace' && soundActive(clip, time));
}
