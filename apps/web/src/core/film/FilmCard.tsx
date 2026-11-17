import type { Card, Shot } from '../../types';
import Icon from '../../ui/Icon';
import './FilmCard.css';

const clock = (seconds: number) => {
  const total = Math.round(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** The film on the canvas: shots come in as numbered lines; the list below sets their order. */
export default function FilmCard({
  sequence,
  cards,
  onPreview,
}: {
  sequence: Shot[];
  cards: Card[];
  onPreview: () => void;
}) {
  const first = cards.find(card => card.id === sequence[0]?.cardId);
  const seconds = sequence.reduce((sum, shot) => sum + shot.duration, 0);
  return (
    <article className="fo-film-card" aria-label="成片">
      <div className="fo-card-top">
        <span>
          <Icon name="film" />
          成片
        </span>
        <span>
          {sequence.length} 镜 · {clock(seconds)}
        </span>
      </div>
      {first ? (
        <button type="button" className="fo-film-cover" aria-label="预览成片" onClick={onPreview}>
          {first.poster || first.kind === 'image' ? (
            <img src={first.poster || first.src} alt="" />
          ) : (
            <video src={first.src} muted preload="metadata" />
          )}
          <span className="fo-film-play">
            <Icon name="play" />
          </span>
        </button>
      ) : (
        <p className="fo-film-empty">从视频右侧的圆点拉线到这里，加入成片</p>
      )}
    </article>
  );
}
