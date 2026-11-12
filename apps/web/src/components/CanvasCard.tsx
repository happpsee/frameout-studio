import { memo } from 'react';
import type { Card } from '../types';
import { CardMedia } from './CardMedia';
import Icon from './Icon';

export const CARD_WIDTH = 270,
  CARD_HEIGHT = 219;
export const pending = (card?: Card) => Boolean(card?.job && card.job.status !== 'succeeded');
const statuses: Record<string, string> = {
  submitting: '正在提交',
  queued: '等待生成',
  running: '正在生成',
  paused: '已停止本页等待',
  failed: '生成失败',
  cancelled: '任务已取消',
};
export const videoStatus = (card: Card) => statuses[card.job?.status ?? ''] ?? '等待查询';

type Props = {
  card: Card;
  x: number;
  y: number;
  selected: boolean;
  dragging: boolean;
  reference: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onDuration: (card: Card, duration: number) => void;
};

// Memoized so a drag frame or a selection change re-renders only the cards it touches.
export const CanvasCard = memo(function CanvasCard({
  card,
  x,
  y,
  selected,
  dragging,
  reference,
  onSelect,
  onOpen,
  onDuration,
}: Props) {
  return (
    <article
      data-id={card.id}
      className={`fo-card${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${reference ? ' is-reference' : ''}`}
      style={{ left: x, top: y }}
    >
      <div className="fo-card-top">
        <span>
          <Icon name={card.kind === 'video' ? 'film' : 'image'} />
          {pending(card)
            ? '视频任务'
            : card.missingMedia
              ? '素材需重新导入'
              : (card.label ?? (card.kind === 'video' ? '本地视频' : '画面'))}
        </span>
        <span>
          {pending(card)
            ? videoStatus(card)
            : card.kind === 'video'
              ? card.duration
                ? `${Math.round(card.duration * 100) / 100} SEC`
                : '视频'
              : (card.size ?? card.ratio ?? '16:9')}
        </span>
      </div>
      <button
        type="button"
        className={`fo-media tone-${card.tone ?? 'normal'}`}
        aria-label={`选择素材：${card.name}`}
        onClick={() => onSelect(card.id)}
        onDoubleClick={() => onOpen(card.id)}
      >
        <CardMedia card={card} onDuration={duration => onDuration(card, duration)} />
        <span className="fo-media-marker">{card.kind === 'video' ? '▶' : '+'}</span>
        {pending(card) && <span className="fo-job-status">{videoStatus(card)}</span>}
        {reference && <span className="fo-reference-badge">参考</span>}
      </button>
      <div className="fo-card-bottom">
        <span>{card.name}</span>
        <span>
          {card.provider?.toUpperCase() ??
            (card.mediaId || card.sessionOnly ? 'LOCAL' : 'EXPLORATION')}
        </span>
      </div>
    </article>
  );
});

/** Cards that intersect the viewport plus a screen-space margin, always keeping the pinned ids. */
export function visibleCards(
  cards: Card[],
  camera: { x: number; y: number; zoom: number },
  width: number,
  height: number,
  pinned: (string | null | undefined)[],
  margin = 400,
) {
  const left = (-margin - camera.x) / camera.zoom,
    top = (-margin - camera.y) / camera.zoom;
  const right = (width + margin - camera.x) / camera.zoom,
    bottom = (height + margin - camera.y) / camera.zoom;
  return cards.filter(
    card =>
      pinned.includes(card.id) ||
      (card.x + CARD_WIDTH >= left &&
        card.x <= right &&
        card.y + CARD_HEIGHT >= top &&
        card.y <= bottom),
  );
}
