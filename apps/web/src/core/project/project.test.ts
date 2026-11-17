import { describe, expect, it } from 'vitest';
import { initialState, MISSING_MEDIA, restoreProject, serializeProject } from './project';

function projectWithCards() {
  return {
    ...initialState(),
    cards: ['船灯', '起雾', '返航'].map((name, index) => ({
      id: `shot-card-${index}`,
      x: index * 300,
      y: 20,
      name,
      src: `https://media.example/shot-${index}.png`,
      kind: 'image' as const,
    })),
  };
}

describe('project persistence compatibility', () => {
  it('keeps the lines between cards and the engine mark of a video task', () => {
    const project = projectWithCards();
    Object.assign(project.cards[0], {
      referenceIds: ['a', 'b'],
      linkNames: { a: '猫脸' },
      textIds: ['n1'],
      job: { id: 't', provider: 'ark', status: 'running', prompt: '', config: {}, engine: true },
    });
    const restored = restoreProject(serializeProject(project));
    expect(restored.cards[0].referenceIds).toEqual(['a', 'b']);
    expect(restored.cards[0].linkNames).toEqual({ a: '猫脸' });
    expect(restored.cards[0].textIds).toEqual(['n1']);
    expect(restored.cards[0].job).toMatchObject({ status: 'running', engine: true });
  });

  it('preserves IndexedDB media references without writing object URLs to localStorage', () => {
    const project = projectWithCards();
    Object.assign(project.cards[0], { src: 'blob:current-session', mediaId: 'media-1' });
    const saved = serializeProject(project);
    expect(JSON.stringify(saved)).not.toContain('blob:current-session');
    expect(saved.cards[0].mediaId).toBe('media-1');
    const restored = restoreProject(saved);
    expect(restored.cards[0]).toMatchObject({
      src: MISSING_MEDIA,
      mediaId: 'media-1',
      missingMedia: true,
    });
  });

  it('keeps the video task ID but discards API credential fields during an export', () => {
    const project = projectWithCards();
    const config = {
      provider: 'ark' as const,
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      imageModel: 'image',
      videoModel: 'video',
      imageSize: '1024x1024',
      duration: 5,
      videoRatio: '16:9',
      resolution: '720p',
      transport: 'proxy' as const,
      key: 'must-not-be-exported',
    };
    Object.assign(project.cards[0], {
      job: { id: 'task-123', provider: 'ark', status: 'running', prompt: '森林', config },
      apiKey: 'must-not-be-exported',
      otherConfig: config,
    });
    Object.assign(project, { apiKey: 'must-not-be-exported', config });
    const saved = serializeProject(project);
    expect(JSON.stringify(saved)).not.toContain('must-not-be-exported');
    const restored = restoreProject(saved);
    expect(restored.cards[0].job).toMatchObject({
      id: 'task-123',
      provider: 'ark',
      status: 'paused',
      prompt: '森林',
    });
    expect(restored.cards[0].job?.config).not.toHaveProperty('key');
  });
});
