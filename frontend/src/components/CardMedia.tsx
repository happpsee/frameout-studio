import type { Card } from '../types';

export function CardMedia({ card, className, onDuration }: { card: Card; className?: string; onDuration?: (duration: number) => void }) {
  const style = { objectPosition: card.crop ?? '50% 50%', objectFit: card.provider ? 'contain' as const : 'cover' as const };
  return card.kind === 'video' && !card.missingMedia
    ? <video className={className} src={card.src} poster={card.poster} muted playsInline preload="metadata" draggable={false} style={style} onLoadedMetadata={event => {
      const duration = event.currentTarget.duration;
      if (Number.isFinite(duration) && duration > 0) onDuration?.(duration);
    }} />
    : <img className={className} src={card.src} alt={card.name} draggable={false} style={style} />;
}
