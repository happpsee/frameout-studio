import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card, ProjectState } from '../types';
import ShotList from './ShotList';

const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id,
  x: 0,
  y: 0,
  name: id,
  kind: 'image',
  src: `/${id}.png`,
  ...extra,
});
const project = (value: Partial<ProjectState>): ProjectState => ({
  version: 1,
  title: 't',
  camera: { x: 0, y: 0, zoom: 1 },
  selected: null,
  sequence: [],
  cards: [],
  ...value,
});
afterEach(cleanup);

describe('ShotList', () => {
  it('lists each script with its shots and adds the newest video of a row to the cut', () => {
    const onAddShot = vi.fn();
    const onLocate = vi.fn();
    render(
      <ShotList
        project={project({
          notes: [{ id: 'n1', x: 0, y: 0, kind: 'script', title: '第一集', text: '一\n二' }],
          cards: [
            card('frame', { noteId: 'n1', prompt: '清晨的森林' }),
            card('take', { kind: 'video', sourceId: 'frame', noteId: 'n1' }),
            card('upload'),
          ],
        })}
        onPreview={vi.fn()}
        onAddShot={onAddShot}
        onLocate={onLocate}
      />,
    );
    const episode = screen.getByRole('region', { name: '第一集' });
    expect(within(episode).getByText('脚本 2 个镜头 · 已有 1 个')).toBeTruthy();
    expect(within(episode).getByText('清晨的森林')).toBeTruthy();
    fireEvent.click(within(episode).getByRole('button', { name: '视频加入成片' }));
    expect(onAddShot).toHaveBeenCalledWith('take');
    fireEvent.click(within(episode).getByRole('button', { name: '在画布中编辑脚本' }));
    expect(onLocate).toHaveBeenCalledWith({ noteId: 'n1' });
    const rest = screen.getByRole('region', { name: '其他素材' });
    fireEvent.click(within(rest).getByRole('button', { name: '加入成片' }));
    expect(onAddShot).toHaveBeenLastCalledWith('upload');
  });
});
