import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasCard } from './CanvasCard';
import SelectionActions from './SelectionActions';
import PlanToSequence from './PlanToSequence';
import { failedImageCard } from '../lib/failed-image';
import { regeneration } from '../lib/regenerate';
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

  it('offers only retry and delete', () => {
    const onRegenerate = vi.fn();
    render(
      <SelectionActions
        card={failed}
        outside={false}
        style={{}}
        barRef={createRef()}
        busy={false}
        isReference={false}
        regeneration={regeneration(failed, [failed])}
        onGenerateVideo={vi.fn()}
        onRegenerate={onRegenerate}
        onResume={vi.fn()}
        onToggleReference={vi.fn()}
        onAddShot={vi.fn()}
        onDownload={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const retry = screen.getByRole('button', { name: /再来一张/ });
    expect(retry.getAttribute('title')).toContain('替换');
    fireEvent.click(retry);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '删除选中素材' })).toBeTruthy();
    for (const name of [/图生视频/, /加入成片/, /设为参考/, /下载/])
      expect(screen.queryByRole('button', { name })).toBeNull();
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

  it('is disabled once everything is in the sequence and hidden before any result', () => {
    const run = createWorkflow('一', false, defaults('ark'));
    const project = { ...initialState(), cards: [image('a')], workflow: run };
    const { rerender } = render(
      <PlanToSequence run={run} project={project} onAdd={vi.fn()} toast={vi.fn()} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    run.steps[0].outputCardId = 'a';
    const sequence = [{ id: 's', cardId: 'a', duration: 4 }];
    rerender(
      <PlanToSequence
        run={run}
        project={{ ...project, sequence }}
        onAdd={vi.fn()}
        toast={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '已全部加入成片' })).toHaveProperty('disabled', true);
  });
});
