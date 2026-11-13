import { describe, expect, it, vi } from 'vitest';
import type { Card } from '../types';
import { createThumbnailStore, thumbnailKey, wantsOriginal } from './thumbnails';

const card = (value: Partial<Card> = {}): Card => ({
  id: 'c1',
  x: 0,
  y: 0,
  name: '画面',
  kind: 'image',
  src: 'blob:http://localhost/a',
  ...value,
});

describe('thumbnails', () => {
  it('keys media by its stored file, so copies of one file share a thumbnail', () => {
    expect(thumbnailKey(card({ mediaId: 'media-1' }))).toBe('image:media-1');
    expect(thumbnailKey(card({ id: 'c2', mediaId: 'media-1', src: 'blob:other' }))).toBe(
      'image:media-1',
    );
    expect(thumbnailKey(card({ kind: 'video' }))).toBe('video:blob:http://localhost/a');
  });

  it('skips media that is missing, unfinished, remote, a placeholder, or already has a poster', () => {
    expect(thumbnailKey(card({ missingMedia: true }))).toBeUndefined();
    expect(thumbnailKey(card({ job: { status: 'running' } as Card['job'] }))).toBeUndefined();
    expect(thumbnailKey(card({ src: 'https://example.com/a.png' }))).toBeUndefined();
    expect(thumbnailKey(card({ src: 'data:image/svg+xml;charset=utf-8,x' }))).toBeUndefined();
    expect(thumbnailKey(card({ kind: 'video', poster: '/assets/p.jpg' }))).toBeUndefined();
  });

  it('asks for the original only when the card is drawn wider than the thumbnail', () => {
    expect(wantsOriginal(0.8, 2)).toBe(false);
    expect(wantsOriginal(1, 2)).toBe(false);
    expect(wantsOriginal(2, 2)).toBe(true);
    expect(wantsOriginal(2, 1)).toBe(false);
    expect(wantsOriginal(3, 1)).toBe(true);
  });

  it('makes each thumbnail once and tells subscribers when it is ready', async () => {
    const make = vi.fn(async () => ({ src: 'blob:thumb' }));
    const store = createThumbnailStore(make);
    const listener = vi.fn();
    store.subscribe(listener);
    const media = card({ mediaId: 'media-1' });
    expect(store.peek(media)).toBeUndefined();
    store.request(media);
    store.request(card({ id: 'c2', mediaId: 'media-1' }));
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(make).toHaveBeenCalledTimes(1);
    expect(store.peek(media)).toEqual({ src: 'blob:thumb' });
    store.request(media);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('falls back to the original when a thumbnail cannot be made', async () => {
    const store = createThumbnailStore(async () => {
      throw new Error('cannot decode');
    });
    const media = card();
    store.request(media);
    await vi.waitFor(() => expect(store.peek(media)).toBeNull());
    expect(store.peek(card({ src: 'https://example.com/a.png' }))).toBeNull();
  });

  it('runs a limited number at a time', async () => {
    let running = 0;
    let most = 0;
    const store = createThumbnailStore(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise(resolve => setTimeout(resolve, 1));
      running -= 1;
      return null;
    }, 2);
    const cards = [1, 2, 3, 4, 5].map(n => card({ id: `c${n}`, mediaId: `m${n}` }));
    cards.forEach(store.request);
    await vi.waitFor(() => expect(store.peek(cards[4])).toBeNull());
    expect(most).toBe(2);
  });
});
