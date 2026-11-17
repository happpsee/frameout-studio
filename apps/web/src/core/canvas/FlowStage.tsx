import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  Handle,
  Position,
  ReactFlow,
  type EdgeChange,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import type { Card, Consistency, Note, Shot } from '../../types';
import { CARD_HEIGHT, CARD_WIDTH } from './canvas-camera';
import { cardLinks, linkLabel, type CardLink } from './card-links';
import { FILM_HEIGHT, FILM_ID, FILM_WIDTH, filmLinks, filmPosition } from './film-node';
import LinkEdge, { RenameContext, type LinkEdgeType } from './LinkEdge';
import { NOTE_HEIGHT, NOTE_WIDTH } from './notes';
import { noteNodeId, textLinks } from './text-links';
import { MAX_ZOOM, MIN_ZOOM, type Canvas } from './useCanvas';
import './FlowStage.css';

type CardNode = Node<{ card: Card }, 'card'>;
type NoteNode = Node<{ note: Note }, 'note'>;
type FilmNode = Node<Record<string, never>, 'film'>;
type Render = {
  card: (card: Card) => ReactNode;
  note: (note: Note) => ReactNode;
  film: () => ReactNode;
};
const RenderContext = createContext<Render>({
  card: () => null,
  note: () => null,
  film: () => null,
});

function CardNodeView({ data }: NodeProps<CardNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} className="fo-handle" />
      {useContext(RenderContext).card(data.card)}
      <Handle type="source" position={Position.Right} className="fo-handle" />
    </>
  );
}
function NoteNodeView({ data }: NodeProps<NoteNode>) {
  return (
    <>
      {useContext(RenderContext).note(data.note)}
      {/* Drag from here into a card to make this note part of its prompt. */}
      <Handle type="source" position={Position.Right} className="fo-handle" />
    </>
  );
}
function FilmNodeView() {
  return (
    <>
      {/* Shots only come in: a line from a video to here adds it to the film. */}
      <Handle type="target" position={Position.Left} className="fo-handle" />
      {useContext(RenderContext).film()}
    </>
  );
}
const nodeTypes = { card: CardNodeView, note: NoteNodeView, film: FilmNodeView };
const edgeTypes = { link: LinkEdge };

type Position2 = { x: number; y: number };
const DOT = 14;
/**
 * Cards have a fixed size, so their size and dots are given rather than measured. A node
 * React Flow has to measure loses those numbers whenever it is rebuilt, and then it hides the
 * node's lines until it measures again.
 */
const CARD_HANDLES: NonNullable<CardNode['handles']> = [
  {
    type: 'target',
    position: Position.Left,
    x: -DOT / 2,
    y: (CARD_HEIGHT - DOT) / 2,
    width: DOT,
    height: DOT,
  },
  {
    type: 'source',
    position: Position.Right,
    x: CARD_WIDTH - DOT / 2,
    y: (CARD_HEIGHT - DOT) / 2,
    width: DOT,
    height: DOT,
  },
];

function toNodes(
  cards: Card[],
  notes: Note[],
  film: Position2,
  dragging: Map<string, Position2>,
  chosen: string[],
  raised: ReadonlySet<string>,
): (CardNode | NoteNode | FilmNode)[] {
  return [
    {
      id: FILM_ID,
      type: 'film',
      position: dragging.get(FILM_ID) ?? film,
      data: {},
      width: FILM_WIDTH,
      height: FILM_HEIGHT,
      measured: { width: FILM_WIDTH, height: FILM_HEIGHT },
      handles: [
        {
          type: 'target',
          position: Position.Left,
          x: -DOT / 2,
          y: (FILM_HEIGHT - DOT) / 2,
          width: DOT,
          height: DOT,
        },
      ],
      selectable: false,
    },
    ...cards.map((card): CardNode => ({
      id: card.id,
      type: 'card',
      position: dragging.get(card.id) ?? { x: card.x, y: card.y },
      data: { card },
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      measured: { width: CARD_WIDTH, height: CARD_HEIGHT },
      handles: CARD_HANDLES,
      selected: chosen.includes(card.id),
      // An open prompt box hangs below its card; keep it above the cards around it.
      zIndex: raised.has(card.id) ? 10 : 0,
    })),
    // Notes move themselves by their header, so React Flow neither drags nor pans from them.
    ...notes.map((note): NoteNode => ({
      id: noteNodeId(note.id),
      type: 'note',
      position: { x: note.x, y: note.y },
      data: { note },
      width: NOTE_WIDTH,
      height: NOTE_HEIGHT,
      measured: { width: NOTE_WIDTH, height: NOTE_HEIGHT },
      handles: [
        {
          type: 'source',
          position: Position.Right,
          x: NOTE_WIDTH - DOT / 2,
          y: (NOTE_HEIGHT - DOT) / 2,
          width: DOT,
          height: DOT,
        },
      ],
      draggable: false,
      selectable: false,
      className: 'nopan nowheel',
    })),
  ];
}

/**
 * Reference and text lines can be picked (and deleted); first-frame lines record where a video
 * came from and stay.
 */
function toEdges(
  cards: Card[],
  notes: Note[],
  sequence: Shot[],
  consistency: Consistency | undefined,
  picked: string | null,
): LinkEdgeType[] {
  return [
    // Numbered by place in the film; deleting one takes that shot out.
    ...filmLinks(sequence, cards).map(link => ({
      id: link.id,
      type: 'link' as const,
      source: link.from,
      target: FILM_ID,
      data: { label: link.label, hint: '成片里的第几镜，在下方成片列表里调整顺序' },
      className: 'fo-link is-film',
      selected: link.id === picked,
    })),
    ...cardLinks(cards).map(link => ({
      id: link.id,
      type: 'link' as const,
      source: link.from.id,
      target: link.to.id,
      data: { link, label: linkLabel(link, { cards, consistency }) },
      className: `fo-link is-${link.kind}`,
      selectable: link.kind === 'reference',
      selected: link.id === picked,
    })),
    ...textLinks(cards, notes).map(link => ({
      id: link.id,
      type: 'link' as const,
      source: noteNodeId(link.note.id),
      target: link.card.id,
      data: { label: link.note.title ? `文本 · ${link.note.title}` : '文本' },
      className: 'fo-link is-text',
      selected: link.id === picked,
    })),
  ];
}

/** Ids of the selected cards: the group, or the one selected card. */
export function selectedIds(canvas: Canvas, selected: string | null | undefined) {
  return canvas.selection.ids.length ? canvas.selection.ids : selected ? [selected] : [];
}

/**
 * The canvas itself, drawn by React Flow: cards and notes are nodes, the lines from a card to
 * what was made from it are edges. Positions live in the project; a drag is saved when it ends.
 */
export default function FlowStage({
  canvas,
  cards,
  notes,
  sequence,
  film,
  selected,
  consistency,
  render,
  raised,
  onLink,
  onUnlink,
  onDraft,
  onRename,
}: {
  canvas: Canvas;
  cards: Card[];
  notes: Note[];
  /** The film's shots, drawn as numbered lines into the film card. */
  sequence: Shot[];
  /** Where the film card was put, if it has been moved. */
  film: Position2 | undefined;
  selected: string | null | undefined;
  /** The project's references: they come first, so the numbers on lines count them. */
  consistency: Consistency | undefined;
  render: Render;
  /** Cards drawn above the rest: those with their prompt box open. */
  raised: ReadonlySet<string>;
  /**
   * A line was drawn into the card `to`: from another card (it becomes a reference) or from a
   * note, whose id starts with "note:" (its words join the prompt).
   */
  onLink: (from: string, to: string) => void;
  onUnlink: (linkId: string) => void;
  /** A line was dropped on empty canvas: make a new card there, fed by `from` (card or note). */
  onDraft: (from: string, at: { x: number; y: number }) => void;
  onRename: (link: CardLink, name: string) => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [pickedEdge, setPickedEdge] = useState<string | null>(null);
  const [renamingEdge, setRenamingEdge] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Map<string, Position2>>(new Map());
  const chosen = selectedIds(canvas, selected);
  const filmAt = useMemo(() => filmPosition({ film, cards }), [film, cards]);
  const nodes = useMemo(
    () => toNodes(cards, notes, filmAt, dragging, chosen, raised),
    [cards, notes, filmAt, dragging, chosen, raised],
  );
  const edges = useMemo(
    () => toEdges(cards, notes, sequence, consistency, pickedEdge),
    [cards, notes, sequence, consistency, pickedEdge],
  );
  const onNodesChange = (changes: NodeChange<CardNode | NoteNode | FilmNode>[]) => {
    const moves = changes.filter(change => change.type === 'position' && change.position);
    if (moves.length)
      setDragging(current => {
        const next = new Map(current);
        for (const change of moves)
          if (change.type === 'position' && change.position) next.set(change.id, change.position);
        return next;
      });
    const picks = changes.filter(change => change.type === 'select');
    if (!picks.length) return;
    const next = new Set(chosen);
    for (const change of picks)
      if (change.type === 'select' && !change.id.startsWith('note:'))
        if (change.selected) next.add(change.id);
        else next.delete(change.id);
    if (next.size !== chosen.length || chosen.some(id => !next.has(id)))
      canvas.selection.set([...next]);
  };
  const onEdgesChange = (changes: EdgeChange<LinkEdgeType>[]) => {
    for (const change of changes)
      if (change.type === 'select') setPickedEdge(change.selected ? change.id : null);
      else if (change.type === 'remove') {
        setPickedEdge(null);
        onUnlink(change.id);
      }
  };
  /** Dropped on a card's body or on empty canvas, not on a dot: still connect, or make a card. */
  const onConnectEnd = (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    setConnecting(false);
    const from = state.fromNode?.id;
    if (state.isValid || !from) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    const target = document
      .elementFromPoint(point.clientX, point.clientY)
      ?.closest<HTMLElement>('.react-flow__node');
    const other = target?.dataset.id;
    const backwards = state.fromHandle?.type === 'target';
    if (other) {
      // Notes only give: a line can come out of one but not go into one.
      if (other === from || (other.startsWith('note:') && !backwards)) return;
      if (from === FILM_ID && !backwards) return;
      if (backwards) onLink(other, from);
      else onLink(from, other);
      return;
    }
    const at = instance.current?.screenToFlowPosition({ x: point.clientX, y: point.clientY });
    if (!target && at && !backwards && from !== FILM_ID)
      onDraft(from, { x: at.x, y: at.y - CARD_HEIGHT / 2 });
  };
  const hand = canvas.tool === 'hand';
  const { instance, finishDrag, cameraMoved, cameraRested } = canvas.flow;
  return (
    <RenderContext.Provider value={render}>
      <RenameContext.Provider
        value={{ editing: renamingEdge, setEditing: setRenamingEdge, rename: onRename }}
      >
        <ReactFlow
          className={`fo-flow${connecting ? ' is-connecting' : ''}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgeDoubleClick={(_event, edge) => setRenamingEdge(edge.id)}
          onConnectStart={() => setConnecting(true)}
          onConnect={connection => onLink(connection.source, connection.target)}
          onConnectEnd={onConnectEnd}
          isValidConnection={connection => connection.source !== connection.target}
          connectionRadius={36}
          onNodeDragStop={(event, _node, moved) => {
            setDragging(new Map());
            finishDrag(
              moved.map(node => ({ id: node.id, x: node.position.x, y: node.position.y })),
              'clientY' in event ? event.clientY : 0,
            );
          }}
          onInit={flow => {
            instance.current = flow;
          }}
          defaultViewport={canvas.camera}
          onMoveStart={event => event && canvas.setPanning(true)}
          onMove={(_event, viewport) => cameraMoved(viewport)}
          onMoveEnd={(_event, viewport) => cameraRested(viewport)}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          zoomActivationKeyCode={['Meta', 'Control']}
          panActivationKeyCode="Space"
          panOnDrag
          selectionKeyCode="Shift"
          multiSelectionKeyCode="Shift"
          nodesDraggable={!hand}
          elementsSelectable={!hand}
          nodesConnectable={!hand}
          deleteKeyCode={pickedEdge ? ['Backspace', 'Delete'] : null}
          disableKeyboardA11y
          attributionPosition="bottom-left"
        />
      </RenameContext.Provider>
    </RenderContext.Provider>
  );
}
