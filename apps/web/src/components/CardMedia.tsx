import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Card } from '../types';
import { thumbnails } from '../lib/thumbnails';

export function CardMedia({
  card,
  className,
  original = false,
  onDuration,
}: {
  card: Card;
  className?: string;
  /** Show the stored file even when a thumbnail exists: the card is drawn large. */
  original?: boolean;
  onDuration?: (duration: number) => void;
}) {
  const thumbnail = useSyncExternalStore(thumbnails.subscribe, () => thumbnails.peek(card));
  useEffect(() => thumbnails.request(card), [card]);
  // A video shown by its first frame has no element to report its length; the thumbnail does.
  const posterDuration = card.kind === 'video' ? thumbnail?.duration : undefined;
  const report = useRef(onDuration);
  report.current = onDuration;
  useEffect(() => {
    if (posterDuration) report.current?.(posterDuration);
  }, [posterDuration]);
  const style = {
    objectPosition: card.crop ?? '50% 50%',
    objectFit: card.provider ? ('contain' as const) : ('cover' as const),
  };
  const poster = card.poster ?? thumbnail?.src;
  const stillOnly = !original && Boolean(thumbnail);
  return card.kind === 'video' && !card.missingMedia && !stillOnly ? (
    <video
      className={className}
      src={card.src}
      poster={poster}
      muted
      playsInline
      preload="metadata"
      draggable={false}
      style={style}
      onLoadedMetadata={event => {
        const duration = event.currentTarget.duration;
        if (Number.isFinite(duration) && duration > 0) onDuration?.(duration);
      }}
    />
  ) : (
    <img
      className={className}
      src={stillOnly ? thumbnail!.src : card.src}
      alt={card.name}
      draggable={false}
      style={style}
    />
  );
}
