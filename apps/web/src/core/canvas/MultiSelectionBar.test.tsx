// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCallback, useRef, useState } from 'react';
import type { Card, ProjectState, UpdateProject } from '../../types';
import { useMultiSelection, type MultiSelection } from './useMultiSelection';
import MultiSelectionBar from './MultiSelectionBar';

const card = (id: string, x: number, extra: Partial<Card> = {}): Card => ({
  id,
  x,
  y: 0,
  name: id,
  src: `/${id}.png`,
  kind: 'image',
  ...extra,
});
const commits: ProjectState[] = [];
let selection: MultiSelection;

function Harness({ busy = false, onAddShots = vi.fn(), onArrange = vi.fn(), toast = vi.fn() }) {
  const [project, setProject] = useState<ProjectState>({
    version: 1,
    title: 't',
    camera: { x: 0, y: 0, zoom: 1 },
    selected: null,
    sequence: [{ id: 's', cardId: 'b', duration: 4 }],
    cards: [
      card('c', 900),
      card('a', 0),
      card('job', 300, { job: { status: 'running' } as Card['job'] }),
      card('b', 600),
    ],
  });
  const projectRef = useRef(project);
  const update: UpdateProject = useCallback((recipe, record = true) => {
    const next = structuredClone(projectRef.current);
    recipe(next);
    projectRef.current = next;
    setProject(next);
    if (record) commits.push(next);
  }, []);
  selection = useMultiSelection({ projectRef, update });
  return (
    <>
      <MultiSelectionBar
        selection={selection}
        cards={project.cards}
        enabled
        busy={busy}
        toast={toast}
        onAddShots={onAddShots}
        onArrange={onArrange}
      />
      <output data-testid="cards">{project.cards.map(c => c.id).join(',')}</output>
    </>
  );
}
afterEach(() => {
  cleanup();
  commits.length = 0;
});

describe('MultiSelectionBar', () => {
  it('adds finished cards to the cut in visual order', () => {
    const onAddShots = vi.fn();
    render(<Harness onAddShots={onAddShots} />);
    act(() => selection.add(['c', 'job', 'a', 'b']));
    fireEvent.click(screen.getByRole('button', { name: '加入成片' }));
    expect(onAddShots).toHaveBeenCalledWith(['a', 'b', 'c']);
  });
  it('deletes every selected card as one undo step, from the button or the keyboard', () => {
    render(<Harness />);
    act(() => selection.add(['a', 'b']));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(commits).toHaveLength(1);
    expect(commits[0].cards.map(c => c.id)).toEqual(['c', 'job']);
    expect(commits[0].sequence).toEqual([]);
    expect(screen.queryByText(/已选/)).toBeNull();

    act(() => selection.add(['c', 'job']));
    fireEvent.keyDown(document.body, { key: 'Backspace' });
    expect(commits).toHaveLength(2);
    expect(screen.getByTestId('cards').textContent).toBe('');
  });
  it('does not delete while a generation is running', () => {
    const toast = vi.fn();
    render(<Harness busy toast={toast} />);
    act(() => selection.add(['a', 'b']));
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(commits).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith('先停止本页等待，再删除素材');
  });
});
