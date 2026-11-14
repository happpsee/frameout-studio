import { describe, expect, it } from 'vitest';
import {
  nextRole,
  normalizeConsistency,
  referenceCards,
  supportsReferences,
  withNotes,
  withReferenceRoles,
} from './consistency';
import { restoreProject, serializeProject, initialState } from './project';
import type { Card } from '../types';

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
  it('keeps only existing, distinct image references, at most four', () => {
    const cards = ['a', 'b', 'c', 'd', 'e']
      .map(id => image(id))
      .concat(image('clip', { kind: 'video' }));
    expect(
      normalizeConsistency(
        { notes: '  红色雨衣  ', references: ['a', 'a', 'clip', 'gone', 'b', 'c', 'd', 'e'] },
        cards,
      ),
    ).toEqual({ notes: '红色雨衣', references: ['a', 'b', 'c', 'd'] });
    expect(normalizeConsistency({ notes: ' ', references: ['gone'] }, cards)).toBeUndefined();
    expect(normalizeConsistency('nope', cards)).toBeUndefined();
  });
  it('sends only readable, finished images and appends notes to prompts', () => {
    const cards = [
      image('ok'),
      image('lost', { missingMedia: true }),
      image('job', {
        job: { id: '', provider: 'ark', status: 'running', prompt: '', config: {} as never },
      }),
    ];
    expect(
      referenceCards({ cards, consistency: { notes: '', references: ['lost', 'ok', 'job'] } }).map(
        card => card.id,
      ),
    ).toEqual(['ok']);
    expect(withNotes('雨夜回头', '红色雨衣')).toBe(
      '雨夜回头\n\n统一设定（所有镜头保持一致）：红色雨衣',
    );
    expect(withNotes('雨夜回头', '  ')).toBe('雨夜回头');
    expect([
      supportsReferences('openai'),
      supportsReferences('ark'),
      supportsReferences('compatible'),
    ]).toEqual([true, true, false]);
  });
  it('tells the model what each tagged reference is for, numbered as sent', () => {
    const references = [
      image('a', { role: 'character' }),
      image('b'),
      image('c', { role: 'style' }),
    ];
    expect(withReferenceRoles('雨夜回头', references)).toBe(
      '雨夜回头\n\n参考图 1：角色，保持长相、发型和服装一致；参考图 3：只参考画风和色调',
    );
    expect(withReferenceRoles('雨夜回头', [image('a')])).toBe('雨夜回头');
  });
  it('steps a reference through the roles and back to unset', () => {
    const seen = [];
    let role = nextRole();
    while (role) {
      seen.push(role);
      role = nextRole(role);
    }
    expect(seen).toEqual(['character', 'scene', 'prop', 'style']);
  });
  it('keeps a role through save and reload, and drops an unknown one', () => {
    const project = {
      ...initialState(),
      cards: [image('a', { role: 'scene' }), image('b', { role: 'villain' as Card['role'] })],
    };
    const restored = restoreProject(JSON.parse(JSON.stringify(serializeProject(project))));
    expect(restored.cards.map(card => card.role)).toEqual(['scene', undefined]);
  });
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
