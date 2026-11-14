import { describe, expect, it } from 'vitest';
import { restoreProject, serializeProject, initialState } from '../project/project';
import type { Card } from '../../types';

const image = (id: string, extra: Partial<Card> = {}): Card => ({
  id,
  x: 0,
  y: 0,
  name: id,
  kind: 'image',
  src: `https://media.example/${id}.png`,
  ...extra,
});

describe('shot consistency settings', () => {
  it('round-trips with the project and drops references to removed or session-only cards', () => {
    const project = {
      ...initialState(),
      cards: [image('keep'), image('temp', { sessionOnly: true })],
      consistency: { notes: '冷色调', references: ['keep', 'temp'] },
    };
    const saved = serializeProject(project);
    expect(saved.consistency).toEqual({ notes: '冷色调', references: ['keep'] });
    expect(restoreProject(JSON.parse(JSON.stringify(saved))).consistency).toEqual({
      notes: '冷色调',
      references: ['keep'],
    });
  });
});
