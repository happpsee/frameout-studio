import type { Card } from '../types';
import { CARD_WIDTH } from './canvas-camera';

/**
 * Small stand-ins for canvas media. A generated image is 1.5K to 2K pixels wide and a card shows
 * it 270 wide, so every visible card would otherwise keep a full decoded bitmap, and every video
 * card a `<video>` element. A thumbnail is made once per media file and kept for the session;
 * the original is shown again when the canvas is zoomed in far enough to need it.
 */
export const THUMB_WIDTH = 540;
/** An image this narrow is already cheap; a thumbnail would not help. */
const SMALL_ENOUGH = 720;
const VIDEO_TIMEOUT = 8000;

export type Thumbnail = { src: string; duration?: number };
type Maker = (card: Card) => Promise<Thumbnail | null>;

/** The card needs the original: it is drawn wider than a thumbnail can fill sharply. */
export const wantsOriginal = (zoom: number, pixelRatio = 1) =>
  zoom * CARD_WIDTH * pixelRatio > THUMB_WIDTH * 1.25;

/**
 * The cache key for a card's media, or undefined when no thumbnail should be made: media that
 * is missing, unfinished or a placeholder, and remote files, which the page may not read back.
 */
export function thumbnailKey(card: Card): string | undefined {
  if (card.missingMedia || card.job) return;
  if (card.kind === 'video' && card.poster) return;
  const local = /^(?:blob:|\/assets\/)/.test(card.src) || /^data:image\/(?!svg)/.test(card.src);
  if (!local) return;
  return `${card.kind}:${card.mediaId ?? card.src}`;
}

/** Makes each thumbnail once, a few at a time, and tells subscribers when one is ready. */
export function createThumbnailStore(make: Maker, concurrency = 2) {
  const done = new Map<string, Thumbnail | null>();
  const queued = new Set<string>();
  const waiting: { key: string; card: Card }[] = [];
  const listeners = new Set<() => void>();
  let running = 0;
  function next() {
    while (running < concurrency && waiting.length) {
      const { key, card } = waiting.shift()!;
      running += 1;
      make(card)
        .catch(() => null)
        .then(result => {
          running -= 1;
          done.set(key, result);
          listeners.forEach(listener => listener());
          next();
        });
    }
  }
  return {
    /** The thumbnail when ready; null when the original should be used; undefined while pending. */
    peek: (card: Card) => {
      const key = thumbnailKey(card);
      return key ? done.get(key) : null;
    },
    request(card: Card) {
      const key = thumbnailKey(card);
      if (!key || done.has(key) || queued.has(key)) return;
      queued.add(key);
      waiting.push({ key, card });
      next();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

async function encode(source: CanvasImageSource, width: number, height: number) {
  const scale = Math.min(1, THUMB_WIDTH / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/webp', 0.82),
  );
  return blob && URL.createObjectURL(blob);
}

async function imageThumbnail(card: Card): Promise<Thumbnail | null> {
  const response = await fetch(card.src);
  if (!response.ok) return null;
  const bitmap = await createImageBitmap(await response.blob());
  try {
    if (bitmap.width <= SMALL_ENOUGH) return null;
    const src = await encode(bitmap, bitmap.width, bitmap.height);
    return src ? { src } : null;
  } finally {
    bitmap.close();
  }
}

/** The first frame of a video, and its length, read from an element that is then released. */
function videoThumbnail(card: Card): Promise<Thumbnail | null> {
  return new Promise(resolve => {
    const video = document.createElement('video');
    const finish = (value: Thumbnail | null) => {
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), VIDEO_TIMEOUT);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onerror = () => finish(null);
    video.onloadeddata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      encode(video, video.videoWidth, video.videoHeight).then(
        src => finish(src ? { src, ...(duration ? { duration } : {}) } : null),
        () => finish(null),
      );
    };
    video.src = card.src;
  });
}

const supported = () => typeof createImageBitmap === 'function' && typeof fetch === 'function';
export const thumbnails = createThumbnailStore(async card => {
  // Test environments have no canvas; without one the original is simply shown as before.
  if (!supported()) return null;
  return card.kind === 'video' ? videoThumbnail(card) : imageThumbnail(card);
});
