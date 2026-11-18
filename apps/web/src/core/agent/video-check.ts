import FFT from 'fft.js';
import type { Card } from '../../types';
import { canvasOf, jpeg, loadVideo, seek } from './media-view';

// What an agent cannot see in a sheet of frames or cannot hear at all, measured: stretches
// where the picture barely moves, and how the sound runs (loudness, clipping, treble, and a
// spectrogram to look at). Generated clips are checked with this before they are reported done.

/** Frames compared per second, and the size they are compared at. */
const MOTION_RATE = 4;
const MOTION_WIDTH = 48;
/** Each compared cell is the average of BLOCK × BLOCK drawn pixels, which evens out grain. */
const BLOCK = 4;
/**
 * Mean grey-level change (0–255) between two samples under which the picture counts as still.
 * A hand-held shot of a held pose measures 2 to 3; a character actually moving, 4 and up.
 */
const STILL = 3.2;
/** A still stretch is reported once it lasts this long. */
const STILL_SECONDS = 1;

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const decibels = (value: number) => (value > 0 ? round(10 * Math.log10(value), 1) : -120);

/** Stretches where the picture barely moves: `changes[i]` is the change over step i. */
export function stillSpans(changes: number[], step: number, threshold = STILL) {
  const spans: { from: number; to: number }[] = [];
  let start = -1;
  for (let i = 0; i <= changes.length; i++) {
    const still = i < changes.length && changes[i] < threshold;
    if (still && start < 0) start = i;
    if (!still && start >= 0) {
      if ((i - start) * step >= STILL_SECONDS)
        spans.push({ from: round(start * step), to: round(i * step) });
      start = -1;
    }
  }
  return spans;
}

/** The picture as a coarse grid of grey levels, each the average of a block of pixels. */
function greyGrid({ data, width, height }: ImageData, block: number) {
  const columns = width / block;
  const grid = new Float32Array(columns * (height / block));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      grid[Math.floor(y / block) * columns + Math.floor(x / block)] +=
        (data[at] + data[at + 1] + data[at + 2]) / 3 / (block * block);
    }
  return grid;
}

async function motion(card: Card) {
  const video = await loadVideo(card.src);
  try {
    const rows = Math.round((MOTION_WIDTH * video.videoHeight) / video.videoWidth);
    const canvas = canvasOf(MOTION_WIDTH * BLOCK, rows * BLOCK);
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const step = 1 / MOTION_RATE;
    const changes: number[] = [];
    let previous: Float32Array | null = null;
    for (let time = 0; time < video.duration; time += step) {
      await seek(video, time);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const grid = greyGrid(context.getImageData(0, 0, canvas.width, canvas.height), BLOCK);
      if (previous) {
        let sum = 0;
        for (let i = 0; i < grid.length; i++) sum += Math.abs(grid[i] - previous[i]);
        changes.push(round(sum / grid.length));
      }
      previous = grid;
    }
    return { seconds: round(video.duration), still: stillSpans(changes, step), changes };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

const RATE = 32_000;
const WINDOW = 1024;
const SEGMENT = 0.5;
/** Above this, sound counts as treble; a clip that loses it sounds muffled. */
const TREBLE_HZ = 5000;
const SPECTRUM_WIDTH = 960;

/** Loudness of each half second, and how many samples sit at full scale (clipping). */
export function loudness(samples: Float32Array, rate: number) {
  const size = Math.round(SEGMENT * rate);
  const segments: number[] = [];
  let peak = 0;
  let clipped = 0;
  for (let start = 0; start < samples.length; start += size) {
    let sum = 0;
    const end = Math.min(samples.length, start + size);
    for (let i = start; i < end; i++) {
      const value = Math.abs(samples[i]);
      sum += value * value;
      if (value > peak) peak = value;
      if (value >= 0.999) clipped++;
    }
    segments.push(decibels(sum / (end - start)));
  }
  return { segments, peakDb: decibels(peak * peak), clipped };
}

/** The spectrogram as a picture (time →, 0–12 kHz ↑), and the share of treble per half second. */
function spectrum(samples: Float32Array) {
  const fft = new FFT(WINDOW);
  const out = fft.createComplexArray() as number[];
  const frame = new Array<number>(WINDOW);
  const bins = Math.round((12_000 / (RATE / 2)) * (WINDOW / 2));
  const trebleBin = Math.round((TREBLE_HZ / (RATE / 2)) * (WINDOW / 2));
  const canvas = canvasOf(SPECTRUM_WIDTH, bins + 16);
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(SPECTRUM_WIDTH, bins);
  const seconds = samples.length / RATE;
  const count = Math.ceil(seconds / SEGMENT);
  const total = new Array<number>(count).fill(0);
  const treble = new Array<number>(count).fill(0);
  for (let x = 0; x < SPECTRUM_WIDTH; x++) {
    const start = Math.floor((x / SPECTRUM_WIDTH) * Math.max(1, samples.length - WINDOW));
    for (let i = 0; i < WINDOW; i++)
      frame[i] = (samples[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW));
    fft.realTransform(out, frame);
    const segment = Math.min(count - 1, Math.floor(start / RATE / SEGMENT));
    for (let bin = 0; bin < bins; bin++) {
      const power = (out[2 * bin] ** 2 + out[2 * bin + 1] ** 2) / WINDOW ** 2;
      total[segment] += power;
      if (bin >= trebleBin) treble[segment] += power;
      // -100 dB is black, -20 dB and above is white, through red and yellow.
      const level = Math.min(1, Math.max(0, (10 * Math.log10(power + 1e-12) + 100) / 80));
      const at = ((bins - 1 - bin) * SPECTRUM_WIDTH + x) * 4;
      image.data[at] = 255 * Math.min(1, level * 3);
      image.data[at + 1] = 255 * Math.min(1, Math.max(0, level * 3 - 1));
      image.data[at + 2] = 255 * Math.min(1, Math.max(0, level * 3 - 2));
      image.data[at + 3] = 255;
    }
  }
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.putImageData(image, 0, 0);
  context.fillStyle = '#fff';
  context.font = '11px sans-serif';
  for (let second = 0; second < seconds; second++)
    context.fillText(`${second}s`, (second / seconds) * SPECTRUM_WIDTH + 2, bins + 12);
  return {
    data: jpeg(canvas),
    trebleDb: total.map((value, i) => (value > 0 ? decibels(treble[i] / value) : -120)),
  };
}

async function sound(card: Card) {
  const encoded = await (await fetch(card.src)).arrayBuffer();
  const decoded = await new OfflineAudioContext(1, 1, RATE)
    .decodeAudioData(encoded)
    .catch(() => null);
  if (!decoded) return null;
  const context = new OfflineAudioContext(1, decoded.length, RATE);
  const node = context.createBufferSource();
  node.buffer = decoded;
  node.connect(context.destination);
  node.start();
  const samples = (await context.startRendering()).getChannelData(0);
  const { data, trebleDb } = spectrum(samples);
  return { ...loudness(samples, RATE), trebleDb, data };
}

/** check_video: where the picture stands still, and how the sound runs. */
export async function checkVideo(card: Card) {
  if (card.kind !== 'video' || card.missingMedia) throw new Error('只能检查已生成好的视频卡片');
  const picture = await motion(card);
  const audio = await sound(card);
  return {
    seconds: picture.seconds,
    still: picture.still,
    changePerQuarterSecond: picture.changes,
    sound: audio
      ? {
          peakDb: audio.peakDb,
          clippedSamples: audio.clipped,
          loudnessDbPerHalfSecond: audio.segments,
          trebleShareDbPerHalfSecond: audio.trebleDb,
        }
      : null,
    spectrogram: audio?.data,
  };
}
