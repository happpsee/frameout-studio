import { describe, expect, it } from 'vitest';
import { AUDIO_RATE, framesBetween, placeFrames, planAudio } from './export-audio';
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

  it('places a clip from its start and cuts it at the end of the shot', () => {
    // A piece starting inside the shot is copied whole.
    expect(placeFrames(1, 1024, 44100, 44100 * 3)).toEqual({ at: 44100, from: 0, count: 1024 });
    // Encoder priming before the clip's start is skipped.
    expect(placeFrames(-0.01, 1024, 48000, 48000)).toEqual({ at: 0, from: 480, count: 544 });
    // The piece crossing the shot's end is cut there; pieces after it are dropped.
    expect(placeFrames(0.99, 1024, 48000, 48000)).toEqual({ at: 47520, from: 0, count: 480 });
    expect(placeFrames(1, 1024, 48000, 48000)).toBeNull();
    expect(placeFrames(-1, 1024, 48000, 48000)).toBeNull();
  });

  it('adds a sound track only when some clip has sound the browser can handle', () => {
    expect(planAudio([], true)).toBe('none');
    expect(planAudio(['none', 'none'], true)).toBe('none');
    expect(planAudio(['none', 'ok'], true)).toBe('kept');
    expect(planAudio(['ok', 'undecodable'], true)).toBe('kept');
    expect(planAudio(['ok'], false)).toBe('unsupported');
    expect(planAudio(['none', 'undecodable'], true)).toBe('unsupported');
  });
});
