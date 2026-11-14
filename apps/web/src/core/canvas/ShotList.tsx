import type { Card, ProjectState } from '../../types';
import { rowPick, shotSections, type ShotRow } from './shot-list';
import { scriptShots } from './notes';
import { CardMedia } from './CardMedia';
import { pending, videoStatus } from './CanvasCard';
import './ShotList.css';

type Props = {
  project: ProjectState;
  onPreview: (card: Card) => void;
  /** Appends one card to the sequence. */
  onAddShot: (id: string) => void;
  /** Leaves the list and shows the card (or script) where it is on the canvas. */
  onLocate: (target: { card?: Card; noteId?: string }) => void;
};

/**
 * The project as a plain list, for working without the canvas: each script with its shots,
 * each shot with its image, its videos and one button to put it in the cut. It reads the same
 * cards and notes as the canvas; nothing is stored separately.
 */
export default function ShotList({ project, onPreview, onAddShot, onLocate }: Props) {
  const sections = shotSections(project);
  const inCut = new Set(project.sequence.map(shot => shot.cardId));
  const empty = !project.cards.length && !project.notes?.length;
  return (
    <div className="fo-shot-list" aria-label="镜头列表">
      {empty && <p className="fo-shot-empty">还没有素材。在下方输入框生成，或回画布添加。</p>}
      {sections.map(section => (
        <section key={section.id} aria-label={section.title}>
          {!(empty && section.id === 'loose') && (
            <header>
              <h2>{section.title}</h2>
              <span>
                {section.note
                  ? `脚本 ${scriptShots(section.note.text).length} 个镜头 · 已有 ${section.rows.length} 个`
                  : `${section.rows.length} 个`}
              </span>
              {section.note && (
                <button type="button" onClick={() => onLocate({ noteId: section.note!.id })}>
                  在画布中编辑脚本
                </button>
              )}
            </header>
          )}
          {section.note && !section.rows.length && (
            <p className="fo-shot-empty">这份脚本还没有生成画面。回画布选中它，点「编排分镜」。</p>
          )}
          <ol>
            {section.rows.map((row, index) => (
              <Row
                key={row.card.id}
                row={row}
                index={index}
                inCut={inCut}
                onPreview={onPreview}
                onAddShot={onAddShot}
                onLocate={onLocate}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Thumb({ card, onPreview }: { card: Card; onPreview: (card: Card) => void }) {
  const waiting = pending(card);
  return (
    <button
      type="button"
      className="fo-shot-thumb"
      aria-label={`预览：${card.name}`}
      disabled={waiting || card.missingMedia}
      onClick={() => onPreview(card)}
    >
      <CardMedia card={card} />
      <span>{waiting ? videoStatus(card) : card.kind === 'video' ? '视频' : '图片'}</span>
    </button>
  );
}

function Row({
  row,
  index,
  inCut,
  onPreview,
  onAddShot,
  onLocate,
}: {
  row: ShotRow;
  index: number;
  inCut: Set<string>;
} & Pick<Props, 'onPreview' | 'onAddShot' | 'onLocate'>) {
  const { card, takes } = row;
  const pick = rowPick(row);
  const added = [card, ...takes].some(item => inCut.has(item.id));
  return (
    <li>
      <span className="fo-shot-number">{String(index + 1).padStart(2, '0')}</span>
      <div className="fo-shot-media">
        <Thumb card={card} onPreview={onPreview} />
        {takes.map(take => (
          <Thumb key={take.id} card={take} onPreview={onPreview} />
        ))}
      </div>
      <p title={card.prompt}>{card.prompt || card.job?.prompt || card.name}</p>
      <div className="fo-shot-actions">
        <button
          type="button"
          className="is-primary"
          disabled={!pick}
          title={pick ? undefined : '这个镜头还没有完成'}
          onClick={() => pick && onAddShot(pick.id)}
        >
          {added ? '再加一次' : pick?.kind === 'video' ? '视频加入成片' : '加入成片'}
        </button>
        <button type="button" onClick={() => onLocate({ card })}>
          在画布中查看
        </button>
      </div>
    </li>
  );
}
