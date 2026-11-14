import { useCallback, useState, type RefObject } from 'react';
import type { Card, ProjectState, UpdateProject } from '../../types';
import { pending } from '../canvas/CanvasCard';
import { clamp } from '../canvas/canvas-camera';
import { uid } from '../project/project';
import type { PreviewItem } from './PreviewDialog';

function clipDuration(card: Card) {
  const duration = card.duration;
  return card.kind === 'video' &&
    typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration > 0
    ? duration
    : 4;
}
/** The film: which shots are in it, and opening its preview and export. */
export function useFilm({
  project,
  projectRef,
  update,
  toast,
}: {
  project: ProjectState;
  projectRef: RefObject<ProjectState>;
  update: UpdateProject;
  toast: (message: string) => void;
}) {
  const [timelineOpen, setTimelineOpen] = useState(() => project.sequence.length > 0);
  const [preview, setPreview] = useState<{ items: PreviewItem[]; title: string } | null>(null);
  const [exporting, setExporting] = useState<{ items: PreviewItem[]; skipped: number } | null>(
    null,
  );

  const toggleTimeline = useCallback(() => setTimelineOpen(value => !value), []);
  const addToSequence = useCallback(
    // Several ids are added in order as one undo step; unfinished media is skipped.
    (ids: string | string[]) => {
      const cards = [ids].flat().flatMap(id => {
        const card = projectRef.current.cards.find(c => c.id === id);
        return card && !card.missingMedia && !pending(card) ? [card] : [];
      });
      if (!cards.length) return;
      update(draft => {
        for (const card of cards)
          draft.sequence.push({
            id: uid(),
            cardId: card.id,
            duration: clamp(clipDuration(card), 1, 15),
          });
      });
      setTimelineOpen(true);
      toast(
        cards.length > 1
          ? `已加入成片 ${cards.length} 个镜头 · 在下方拖动调整顺序`
          : '已加入成片 · 在下方拖动调整顺序',
      );
    },
    [projectRef, update, toast],
  );
  // Shots the preview and export can play: skips missing or unfinished media.
  function sequenceItems(): PreviewItem[] {
    return project.sequence.flatMap(shot => {
      const source = project.cards.find(c => c.id === shot.cardId);
      return source && !source.missingMedia && !pending(source)
        ? [{ card: source, duration: shot.duration }]
        : [];
    });
  }
  function openExport() {
    const items = sequenceItems();
    if (!items.length) {
      toast('成片里还没有可导出的镜头');
      return;
    }
    setExporting({ items, skipped: project.sequence.length - items.length });
  }
  function openPreview(card?: Card) {
    if (card && (card.missingMedia || pending(card))) {
      toast('该素材尚未完成或需要重新导入');
      return;
    }
    const items = card ? [{ card, duration: clipDuration(card) }] : sequenceItems();
    if (!items.length) {
      toast('先选择素材并加入成片，再开始预览');
      return;
    }
    setPreview({ items, title: card?.name ?? project.title });
  }
  function updateDuration(card: Card, duration: number) {
    const current = projectRef.current.cards.find(item => item.id === card.id);
    if (!current || current.src !== card.src || current.duration === duration) return;
    update(draft => {
      const target = draft.cards.find(item => item.id === card.id);
      if (target) target.duration = duration;
    }, false);
  }
  const closePreview = useCallback(() => setPreview(null), []);
  const closeExport = useCallback(() => setExporting(null), []);
  return {
    timelineOpen,
    toggleTimeline,
    preview,
    closePreview,
    exporting,
    closeExport,
    addToSequence,
    openExport,
    openPreview,
    updateDuration,
  };
}
