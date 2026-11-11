import { describe, expect, it } from 'vitest';
import { initialState, MISSING_MEDIA, restoreProject, serializeProject } from './project';

function projectWithCards() {
  return {
    ...initialState(),
    cards: ['船灯', '起雾', '返航'].map((name, index) => ({
      id: `shot-card-${index}`, x: index * 300, y: 20, name,
      src: `https://media.example/shot-${index}.png`, kind: 'image' as const,
    })),
  };
}

describe('project persistence compatibility', () => {
  it('restores relative asset paths that are not bundled demos', () => {
    const old = projectWithCards();
    old.cards[0].src = 'assets/own-photo.png';
    old.selected = old.cards[0].id;
    old.sequence = [{ id: 'shot-1', cardId: old.cards[0].id, duration: 6 }];
    const restored = restoreProject(old);
    expect(restored.cards[0].src).toBe('/assets/own-photo.png');
    expect(restored.selected).toBe(old.selected);
    expect(restored.sequence).toEqual(old.sequence);
    expect(restored.camera).toEqual(old.camera);
  });

  it('drops legacy examples and demo copies while preserving real media and its timeline', () => {
    const original = projectWithCards();
    const localCard = { ...original.cards[0], src: '', mediaId: 'original-upload' };
    const providerCard = { ...original.cards[1], provider: 'ark', label: 'AI 生成图片' };
    const saved = {
      ...original,
      cards: [
        localCard,
        providerCard,
        { ...original.cards[2], id: 'forest-wide', src: 'assets/forest-astronaut.png' },
        { ...original.cards[2], id: 'example-ocean', src: '/assets/still-ocean.webp', label: '灵感样例' },
        { ...localCard, id: 'demo-copy', name: `${localCard.name} · 动态`, label: '动态预览', motion: true },
      ],
      selected: 'demo-copy',
      sequence: [
        { id: 'local-shot', cardId: localCard.id, duration: 6 },
        { id: 'sample-shot', cardId: 'forest-wide', duration: 4 },
        { id: 'provider-shot', cardId: providerCard.id, duration: 5 },
        { id: 'copy-shot', cardId: 'demo-copy', duration: 4 },
      ],
    };
    const restored = restoreProject(saved);
    expect(restored.cards.map(card => card.id)).toEqual([localCard.id, providerCard.id]);
    expect(restored.cards[0]).toMatchObject({ mediaId: localCard.mediaId, missingMedia: true });
    expect(restored.cards[1]).toMatchObject({ src: providerCard.src, provider: 'ark' });
    expect(restored.sequence.map(shot => shot.id)).toEqual(['local-shot', 'provider-shot']);
    expect(restored.selected).toBeNull();
  });

  it('preserves IndexedDB media references without writing object URLs to localStorage', () => {
    const project = projectWithCards();
    Object.assign(project.cards[0], { src: 'blob:current-session', mediaId: 'media-1' });
    const saved = serializeProject(project);
    expect(JSON.stringify(saved)).not.toContain('blob:current-session');
    expect(saved.cards[0].mediaId).toBe('media-1');
    const restored = restoreProject(saved);
    expect(restored.cards[0]).toMatchObject({ src: MISSING_MEDIA, mediaId: 'media-1', missingMedia: true });
  });

  it('keeps the video task ID but discards API credential fields during an export', () => {
    const project = projectWithCards();
    const config = { provider: 'ark' as const, baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', imageModel: 'image', videoModel: 'video', imageSize: '1024x1024', duration: 5, videoRatio: '16:9', resolution: '720p', transport: 'proxy' as const, key: 'must-not-be-exported' };
    Object.assign(project.cards[0], { job: { id: 'task-123', provider: 'ark', status: 'running', prompt: '森林', config }, apiKey: 'must-not-be-exported', otherConfig: config });
    Object.assign(project, { apiKey: 'must-not-be-exported', config });
    const saved = serializeProject(project);
    expect(JSON.stringify(saved)).not.toContain('must-not-be-exported');
    const restored = restoreProject(saved);
    expect(restored.cards[0].job).toMatchObject({ id: 'task-123', provider: 'ark', status: 'paused', prompt: '森林' });
    expect(restored.cards[0].job?.config).not.toHaveProperty('key');
  });

  it('does not save unavailable session-only files or timeline entries that reference them', () => {
    const project = projectWithCards();
    Object.assign(project.cards[0], { sessionOnly: true });
    project.selected = project.cards[0].id;
    project.sequence = [{ id: 'shot-1', cardId: project.cards[0].id, duration: 4 }];
    const saved = serializeProject(project);
    expect(saved.cards).toHaveLength(2);
    expect(saved.selected).toBeNull();
    expect(saved.sequence).toEqual([]);
  });

  it('filters broken references and clamps a stored camera without discarding valid cards', () => {
    const project = projectWithCards();
    project.camera.zoom = 900;
    project.sequence = [{ id: 'invalid', cardId: 'deleted-card', duration: 5 }, { id: 'valid', cardId: project.cards[0].id, duration: -8 }];
    const restored = restoreProject(project);
    expect(restored.cards).toHaveLength(3);
    expect(restored.camera.zoom).toBe(4);
    expect(restored.sequence).toEqual([{ id: 'valid', cardId: project.cards[0].id, duration: 1 }]);
  });
});
