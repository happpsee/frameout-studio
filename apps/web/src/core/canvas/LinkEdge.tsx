import { createContext, useContext, useRef } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import type { CardLink } from './card-links';

/**
 * `link` is set for lines between cards, which can be renamed; lines from a note or into the film
 * have only a label, and `hint` says where their name comes from.
 */
export type LinkEdgeType = Edge<{ link?: CardLink; label: string; hint?: string }, 'link'>;
type Renaming = {
  /** The line whose name is being edited. Set by double-clicking the line or its label. */
  editing: string | null;
  setEditing: (id: string | null) => void;
  rename: (link: CardLink, name: string) => void;
};
export const RenameContext = createContext<Renaming>({
  editing: null,
  setEditing: () => {},
  rename: () => {},
});

/** A line from a card to what was made from it. Double-click it, or its label, to rename it. */
export default function LinkEdge(props: EdgeProps<LinkEdgeType>) {
  const [path, labelX, labelY] = getBezierPath(props);
  const renaming = useContext(RenameContext);
  const link = props.data!.link;
  const current = link ? (link.to.linkNames?.[link.from.id] ?? '') : '';
  const editing = Boolean(link) && renaming.editing === props.id;
  /** Escape closes the box, which also blurs it; that blur must not save. */
  const done = useRef(false);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    if (link && text !== null && text.trim() !== current) renaming.rename(link, text);
    renaming.setEditing(null);
  };
  return (
    <>
      <BaseEdge id={props.id} path={path} interactionWidth={props.interactionWidth} />
      <EdgeLabelRenderer>
        <div
          className={`fo-link-label nodrag nopan${props.selected ? ' is-selected' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          title={link ? '双击改名' : (props.data!.hint ?? '文本的名字就是它的标题')}
          onDoubleClick={() => link && renaming.setEditing(props.id)}
        >
          {!editing ? (
            props.data!.label
          ) : (
            <input
              autoFocus
              ref={() => {
                done.current = false;
              }}
              defaultValue={current}
              onFocus={event => event.currentTarget.select()}
              maxLength={20}
              placeholder={link?.kind === 'first-frame' ? '首帧' : '参考'}
              aria-label="连线名字"
              onBlur={event => finish(event.currentTarget.value)}
              onKeyDown={event => {
                // Keep Backspace/Delete from reaching the canvas, which would delete the line.
                event.stopPropagation();
                if (event.key === 'Enter') finish(event.currentTarget.value);
                if (event.key === 'Escape') finish(null);
              }}
            />
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
