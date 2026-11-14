import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SelectionActions from './SelectionActions';
import { preferenceOnly } from '../lib/project';
import { defaults } from '../lib/preferences';
import type { Card } from '../types';
import type { Regeneration } from '../lib/regenerate';

afterEach(cleanup);

const image: Card = {
  id: 'img',
  x: 0,
  y: 0,
  name: '灯塔',
  src: 'https://media.example/a.png',
  kind: 'image',
  provider: 'ark',
  prompt: '海边的灯塔',
};
function renderBar(card: Card, regeneration: Regeneration | null, busy = false) {
  const handlers = { onRegenerate: vi.fn(), onResume: vi.fn() };
  render(
    <SelectionActions
      card={card}
      outside={false}
      style={{}}
      barRef={createRef()}
      busy={busy}
      isReference={false}
      regeneration={regeneration}
      onGenerateVideo={vi.fn()}
      onToggleReference={vi.fn()}
      onAddShot={vi.fn()}
      onDownload={vi.fn()}
      onRemove={vi.fn()}
      {...handlers}
    />,
  );
  return handlers;
}

describe('再来一张', () => {
  it('says that it is a new paid request', () => {
    const handlers = renderBar(image, { ok: true, prompt: '海边的灯塔', mode: 'image' });
    const button = screen.getByRole('button', { name: /再来一张/ });
    expect(button.getAttribute('title')).toContain('再计费一次');
    fireEvent.click(button);
    expect(handlers.onRegenerate).toHaveBeenCalledTimes(1);
  });
});

describe('rejected video tasks', () => {
  it('do not offer to keep querying', () => {
    const job = {
      id: '',
      provider: 'ark' as const,
      status: 'rejected',
      prompt: 'p',
      config: preferenceOnly(defaults('ark')),
    };
    renderBar({ ...image, job }, null);
    expect(screen.queryByRole('button', { name: /继续查询/ })).toBeNull();
    cleanup();
    renderBar({ ...image, job: { ...job, status: 'paused' } }, null);
    expect(screen.getByRole('button', { name: /继续查询/ })).toBeTruthy();
  });
});
