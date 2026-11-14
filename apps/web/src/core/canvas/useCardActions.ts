import { useCallback } from 'react';
import type { RefObject } from 'react';
import type { ProjectState, Provider, UpdateProject } from '../../types';
import { MAX_REFERENCES, referenceCards, supportsReferences } from '../generation/consistency';
import { arrange, tidy, type ArrangeMode } from './canvas-layout';

/** What the user can do to cards already on the canvas: delete, mark as reference, arrange, tidy. */
export function useCardActions({
  projectRef,
  update,
  toast,
  active,
  cancelGesture,
  fitCanvas,
  provider,
}: {
  projectRef: RefObject<ProjectState>;
  update: UpdateProject;
  toast: (message: string) => void;
  /** A generation is running; cards cannot be deleted meanwhile. */
  active: boolean;
  cancelGesture: () => void;
  fitCanvas: () => void;
  provider: Provider;
}) {
  const removeSelected = useCallback(() => {
    const id = projectRef.current.selected;
    if (!id) return;
    if (active) {
      toast('先停止本页等待，再删除素材');
      return;
    }
    cancelGesture();
    update(draft => {
      draft.cards = draft.cards.filter(c => c.id !== id);
      draft.sequence = draft.sequence.filter(s => s.cardId !== id);
      draft.selected = null;
      if (draft.consistency)
        draft.consistency.references = draft.consistency.references.filter(ref => ref !== id);
    });
  }, [projectRef, active, cancelGesture, update, toast]);
  const toggleReference = useCallback(
    (id: string) => {
      const references = projectRef.current.consistency?.references ?? [];
      const adding = !references.includes(id);
      if (adding && referenceCards(projectRef.current).length >= MAX_REFERENCES) {
        toast(`最多 ${MAX_REFERENCES} 张参考图，请先移除一张`);
        return;
      }
      update(draft => {
        const consistency = (draft.consistency ??= { notes: '', references: [] });
        consistency.references = adding
          ? [...consistency.references.filter(ref => draft.cards.some(card => card.id === ref)), id]
          : consistency.references.filter(ref => ref !== id);
      });
      toast(
        adding
          ? supportsReferences(provider)
            ? '已设为参考 · 之后生成的图片会参照它'
            : '已设为参考 · 当前服务只使用统一设定'
          : '已取消参考',
      );
    },
    [projectRef, update, toast, provider],
  );
  const arrangeCards = (ids: string[], mode: ArrangeMode) => {
    const positions = arrange(
      projectRef.current.cards.filter(card => ids.includes(card.id)),
      mode,
    );
    update(draft => {
      for (const card of draft.cards) Object.assign(card, positions.get(card.id));
    });
  };
  const tidyCanvas = useCallback(() => {
    const placed = tidy(projectRef.current);
    if (!placed.cards.size && !placed.notes.size) return;
    cancelGesture();
    update(draft => {
      for (const card of draft.cards) Object.assign(card, placed.cards.get(card.id));
      for (const note of draft.notes ?? []) Object.assign(note, placed.notes.get(note.id));
    });
    fitCanvas();
    toast('已整理画布 · 可以撤销');
  }, [projectRef, update, cancelGesture, fitCanvas, toast]);
  return { removeSelected, toggleReference, arrangeCards, tidyCanvas };
}
