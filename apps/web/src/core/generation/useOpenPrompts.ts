import { useCallback, useEffect, useState } from 'react';
import type { Card } from '../../types';

/**
 * Which cards have their prompt box open. A box opens when the user picks its card (not when a
 * generation or a shot plan selects a new result), and stays open, next to the boxes of other
 * cards, until closed or the card is gone.
 */
export function useOpenPrompts(cards: Card[]) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const show = useCallback(
    (id: string) => setOpen(current => (current.has(id) ? current : new Set(current).add(id))),
    [],
  );
  useEffect(() => {
    setOpen(current => {
      const live = [...current].filter(id => cards.some(card => card.id === id));
      return live.length === current.size ? current : new Set(live);
    });
  }, [cards]);
  const close = useCallback(
    (id: string) =>
      setOpen(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      }),
    [],
  );
  return { open, show, close };
}
