import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ProjectState, UpdateProject } from '../../types';
import { removeCards } from './canvas-selection';

type Options = {
  projectRef: RefObject<ProjectState>;
  update: UpdateProject;
  /** Called before cards are removed, to drop any gesture that still holds them. */
  beforeRemove?: () => void;
};

/**
 * Selection of two or more cards. It lives only in memory: the saved project keeps
 * its single `selected` card, which is cleared while several cards are selected.
 * Selecting fewer than two cards falls back to that single selection.
 */
export function useMultiSelection({ projectRef, update, beforeRemove }: Options) {
  const latest = useRef({ projectRef, update, beforeRemove });
  latest.current = { projectRef, update, beforeRemove };
  const [stored, setStored] = useState<string[]>([]);
  const storedRef = useRef(stored);

  const store = useCallback((next: string[]) => {
    if (!next.length && !storedRef.current.length) return;
    storedRef.current = next;
    setStored(next);
  }, []);
  const apply = useCallback(
    (next: string[]) => {
      const unique = [...new Set(next)];
      const { projectRef: project, update: change } = latest.current;
      const single = unique.length === 1 ? unique[0] : null;
      store(unique.length >= 2 ? unique : []);
      if (project.current.selected !== single)
        change(draft => {
          draft.selected = single;
        }, false);
    },
    [store],
  );
  /** Everything selected right now, whether one card or several. */
  const current = useCallback(() => {
    if (storedRef.current.length) return storedRef.current;
    const selected = latest.current.projectRef.current.selected;
    return selected ? [selected] : [];
  }, []);
  const toggle = useCallback(
    (id: string) => {
      const list = current();
      apply(list.includes(id) ? list.filter(item => item !== id) : [...list, id]);
    },
    [apply, current],
  );
  /** Selects one card (or none) on its own, dropping any group. */
  const select = useCallback((id: string | null) => apply(id ? [id] : []), [apply]);
  const add = useCallback((ids: string[]) => apply([...current(), ...ids]), [apply, current]);
  /** `set` replaces the whole selection, as a selection box does. */
  const clear = useCallback(() => store([]), [store]);
  const remove = useCallback(() => {
    const ids = storedRef.current;
    if (ids.length < 2) return;
    latest.current.beforeRemove?.();
    latest.current.update(draft => removeCards(draft, ids));
    store([]);
  }, [store]);

  // Something else picked a single card (generation, the asset list, undo): drop the group.
  const selected = projectRef.current.selected;
  useEffect(() => {
    if (selected) clear();
  }, [selected, clear]);

  const cards = projectRef.current.cards;
  const ids = useMemo(() => {
    const live = stored.filter(id => cards.some(card => card.id === id));
    return live.length >= 2 ? live : [];
  }, [stored, cards]);
  return { ids, select, toggle, add, set: apply, clear, remove };
}
export type MultiSelection = ReturnType<typeof useMultiSelection>;
