import { describe, expect, it } from 'vitest';
import { AUDIO_RATE, framesBetween } from './export-audio';
import { shotFrameTimes } from './export-video';

describe('export sound timeline', () => {
  it('gives each shot the audio frames of exactly its video frames, without drift', () => {
    const fps = 30;
    const durations = [3, 0.7, 5, 1.33, 4];
    let written = 0;
    let audioFrames = 0;
    for (const duration of durations) {
      const start = written / fps;
      written += shotFrameTimes(duration, fps).length;
      audioFrames += framesBetween(start, written / fps);
    }
    expect(audioFrames).toBe(Math.round((written / fps) * AUDIO_RATE));
    expect(framesBetween(0, 1)).toBe(48000);
    expect(framesBetween(2, 2)).toBe(0);
  });
});
