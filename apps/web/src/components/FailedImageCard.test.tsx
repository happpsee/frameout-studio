import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasCard } from './CanvasCard';
import PlanToSequence from './PlanToSequence';
import { failedImageCard } from '../lib/failed-image';
import { defaults } from '../lib/preferences';
import { initialState } from '../lib/project';
import { createWorkflow } from '../lib/workflow';
import type { Card } from '../types';

afterEach(cleanup);

const failed = failedImageCard(
  '海边的灯塔',
  '内容被供应商的安全审核拒绝，请调整描述或参考图后再试',
  defaults('ark'),
  { x: 0, y: 0 },
);

describe('failed image card', () => {
  it('shows that it failed and why', () => {
    render(
      <CanvasCard
        card={failed}
        x={0}
        y={0}
        selected={false}
        dragging={false}
        reference={false}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onDuration={vi.fn()}
      />,
    );
    expect(screen.getAllByText('生成失败').length).toBeGreaterThan(0);
    expect(screen.getByText(/安全审核拒绝/)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('全部加入成片', () => {
  const image = (id: string): Card => ({ id, x: 0, y: 0, name: id, kind: 'image', src: 'blob:x' });

  it('adds the plan’s finished results in plan order and says how many', () => {
    const run = createWorkflow('一\n二\n三', false, defaults('ark'));
    run.steps.forEach((step, index) => (step.outputCardId = ['a', failed.id, 'c'][index]));
    const project = { ...initialState(), cards: [image('c'), failed, image('a')], workflow: run };
    const onAdd = vi.fn();
    const toast = vi.fn();
    render(<PlanToSequence run={run} project={project} onAdd={onAdd} toast={toast} />);
    fireEvent.click(screen.getByRole('button', { name: /全部加入成片/ }));
    expect(onAdd).toHaveBeenCalledWith(['a', 'c']);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('已加入成片 2 个镜头'));
  });
});
