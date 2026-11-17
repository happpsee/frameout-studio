import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card } from '../../types';
import Icon from '../../ui/Icon';
import './ReferenceStrip.css';

type Props = {
  cards: Card[];
  /** The first `global` are the project's references (一致性): fixed here, managed there. */
  global: number;
  /** The rest are linked into the card: they can be reordered and unlinked. */
  editable: boolean;
  onReorder: (ids: string[]) => void;
  onUnlink: (id: string) => void;
  /** A thumbnail was clicked: mention that image in the prompt. */
  onPick?: (index: number) => void;
};

function Thumb({
  card,
  index,
  editable,
  shared,
  onUnlink,
  onPick,
}: { card: Card; index: number; shared: boolean } & Pick<
  Props,
  'editable' | 'onUnlink' | 'onPick'
>) {
  const sortable = useSortable({ id: card.id, disabled: !editable || shared });
  return (
    <li
      ref={sortable.setNodeRef}
      className={`fo-reference-thumb${sortable.isDragging ? ' is-dragging' : ''}${shared ? ' is-shared' : ''}`}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      title={`${shared ? `${card.name} · 一致性参考图，每次生成都会带上` : card.name}\n点一下在提示词里引用`}
      onClick={() => onPick?.(index)}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <img src={card.poster || card.src} alt={card.name} draggable={false} />
      <span className="fo-reference-index">{index + 1}</span>
      {shared && <span className="fo-reference-shared">全局</span>}
      {editable && !shared && (
        <button
          type="button"
          className="fo-reference-unlink"
          aria-label={`断开参考图 ${index + 1}`}
          // Keep the press from starting a drag.
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation();
            onUnlink(card.id);
          }}
        >
          <Icon name="x" />
        </button>
      )}
    </li>
  );
}

/**
 * The reference images a card's prompt box sends, numbered in the order they are sent. Drag to
 * reorder; the numbers are what "图1", "图2" in the prompt refer to.
 */
export default function ReferenceStrip({
  cards,
  global,
  editable,
  onReorder,
  onUnlink,
  onPick,
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const ids = cards.map(card => card.id);
  const own = ids.slice(global);
  const end = ({ active, over }: DragEndEvent) => {
    const from = own.indexOf(String(active.id));
    const to = own.indexOf(String(over?.id));
    if (from < 0 || to < 0 || from === to) return;
    onReorder(arrayMove(own, from, to));
  };
  const linked = cards.length - global;
  return (
    <div className="fo-reference-strip">
      <span className="fo-reference-title">
        {!editable
          ? `参考图 ${cards.length} 张${global ? `（全局 ${global}）` : ''} · 最后一张是这张图本身`
          : linked
            ? `参考图 ${cards.length} 张${global ? `（全局 ${global}）` : ''} · 拖动调整连进来的顺序`
            : `${global ? `全局参考图 ${global} 张；` : ''}从图片右侧的圆点拉线连到这里，可再加参考`}
      </span>
      {cards.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
          <SortableContext items={own} strategy={horizontalListSortingStrategy}>
            <ol>
              {cards.map((card, index) => (
                <Thumb
                  key={card.id}
                  card={card}
                  index={index}
                  editable={editable}
                  shared={index < global}
                  onUnlink={onUnlink}
                  onPick={onPick}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
