import type { AIConfig, Card, ProjectCheckpoint, ProjectState, WorkspaceSnapshot } from '../types';
import { restoreWorkflow } from './workflow';
import { normalizeConsistency } from './consistency';

export { PROJECT_STORAGE_KEY as STORAGE_KEY, CHECKPOINTS_STORAGE_KEY } from './desktop-storage';
const legacySampleSources = new Set([
  '/assets/forest-astronaut.png',
  '/assets/still-ocean.webp',
  '/assets/still-city.webp',
]);
export const placeholder = (text: string) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#252c20"/><text x="320" y="185" fill="#b5c69e" text-anchor="middle" font-family="sans-serif" font-size="22">${text}</text></svg>`,
  );
export const MISSING_MEDIA = placeholder('素材暂不可用');
export const PENDING_MEDIA = placeholder('视频生成任务');
export const uid = () => 'f-' + crypto.randomUUID();
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export const DEFAULT_PROJECT_TITLE = '未命名项目';
export const PROJECT_TITLE_MAX = 40;
/** Label on cards added from a landing example; they are kept, unlike old auto-inserted samples. */
export const EXAMPLE_LABEL = '示例素材';
/** Trims and shortens a typed project name; an empty name falls back to the default. */
export function normalizeProjectTitle(value: string): string {
  const title = Array.from(value.replace(/\s+/g, ' ').trim())
    .slice(0, PROJECT_TITLE_MAX)
    .join('')
    .trim();
  return title || DEFAULT_PROJECT_TITLE;
}
export function initialState(): ProjectState {
  return {
    version: 1,
    title: DEFAULT_PROJECT_TITLE,
    camera: { x: 70, y: 20, zoom: 0.8 },
    selected: null,
    sequence: [],
    cards: [],
  };
}
export const preferenceOnly = (value: Partial<AIConfig>): Omit<AIConfig, 'key'> => ({
  provider: value.provider || 'openai',
  baseUrl: value.baseUrl || '',
  imageModel: value.imageModel || '',
  videoModel: value.videoModel || '',
  imageSize: value.imageSize || '1536x1024',
  duration: Number(value.duration) || 5,
  videoRatio: value.videoRatio || '16:9',
  resolution: value.resolution || '720p',
  transport: value.transport === 'direct' ? 'direct' : 'proxy',
});
function safeSource(src: unknown): string {
  if (typeof src !== 'string') return '';
  if (src.startsWith('assets/')) return '/' + src;
  return /^(?:\/assets\/|https:\/\/|data:image\/|data:video\/|blob:)/i.test(src) ? src : '';
}
function isLegacySample(card: Card): boolean {
  if (card.job || card.label === EXAMPLE_LABEL) return false;
  if (card.label === '演示图片' || card.label === '灵感样例') return true;
  if (
    card.motion &&
    card.label === '动态预览' &&
    typeof card.name === 'string' &&
    card.name.endsWith(' · 动态')
  )
    return true;
  return !card.provider && !card.mediaId && legacySampleSources.has(safeSource(card.src));
}
export function serializeWorkspace(project: WorkspaceSnapshot): WorkspaceSnapshot {
  // Allowlist fields so API credentials and unrelated UI state cannot enter an export.
  const cards = project.cards
    .filter(card => !card.sessionOnly)
    .map(card => {
      const value: Card = {
        id: card.id,
        x: card.x,
        y: card.y,
        name: card.name,
        kind: card.kind,
        src: card.mediaId ? '' : safeSource(card.src),
      };
      const fields = [
        'crop',
        'tone',
        'motion',
        'label',
        'size',
        'ratio',
        'provider',
        'duration',
        'poster',
        'mediaId',
        'remoteTemporary',
        'prompt',
        'sourceId',
        'model',
        'mimeType',
        'requestId',
        'generatedAt',
      ] as const;
      for (const key of fields)
        if (card[key] !== undefined) Object.assign(value, { [key]: card[key] });
      if (card.job)
        value.job = {
          id: card.job.id || '',
          provider: card.job.provider,
          status: card.job.status,
          prompt: card.job.prompt || card.prompt || '',
          config: preferenceOnly(card.job.config),
          error: card.job.error,
          progress: card.job.progress,
        };
      if (value.job && value.job.status !== 'succeeded') value.src = PENDING_MEDIA;
      return value;
    });
  const ids = new Set(cards.map(card => card.id));
  return {
    version: 1,
    title: project.title,
    camera: { ...project.camera },
    selected: project.selected && ids.has(project.selected) ? project.selected : null,
    cards,
    sequence: project.sequence
      .filter(shot => ids.has(shot.cardId))
      .map(({ id, cardId, duration }) => ({ id, cardId, duration })),
  };
}
export function serializeCheckpoints(checkpoints: ProjectCheckpoint[] = []): ProjectCheckpoint[] {
  return checkpoints.slice(-8).map(checkpoint => ({
    id: checkpoint.id,
    name: checkpoint.name.slice(0, 80),
    createdAt: checkpoint.createdAt,
    state: serializeWorkspace(checkpoint.state),
  }));
}
export function serializeProject(project: ProjectState): ProjectState {
  const value: ProjectState = serializeWorkspace(project);
  if (project.workflow) value.workflow = restoreWorkflow(project.workflow, false);
  if (project.checkpoints?.length) value.checkpoints = serializeCheckpoints(project.checkpoints);
  const consistency = normalizeConsistency(project.consistency, value.cards);
  if (consistency) value.consistency = consistency;
  return value;
}
function restoreWorkspace(input: unknown): WorkspaceSnapshot {
  const fallback = initialState();
  if (!input || typeof input !== 'object') return fallback;
  const saved = input as Partial<ProjectState>;
  if (saved.version !== 1 || !Array.isArray(saved.cards) || !Array.isArray(saved.sequence))
    return fallback;
  const seen = new Set<string>();
  const cards = saved.cards
    .filter(card => {
      if (
        !card ||
        typeof card.id !== 'string' ||
        seen.has(card.id) ||
        !Number.isFinite(card.x) ||
        !Number.isFinite(card.y) ||
        isLegacySample(card)
      )
        return false;
      seen.add(card.id);
      return Boolean(card.mediaId || (safeSource(card.src) && !card.src.startsWith('blob:')));
    })
    .map(raw => {
      const card = {
        ...raw,
        name: typeof raw.name === 'string' ? raw.name : '未命名素材',
        src: raw.mediaId ? MISSING_MEDIA : safeSource(raw.src),
        missingMedia: Boolean(raw.mediaId),
      } as Card;
      if (typeof card.prompt !== 'string') delete card.prompt;
      if (typeof card.sourceId !== 'string') delete card.sourceId;
      if (card.job) {
        card.job = {
          ...card.job,
          prompt: card.job.prompt || card.prompt || '',
          config: preferenceOnly(card.job.config || {}),
        };
        if (['submitting', 'queued', 'running'].includes(card.job.status))
          card.job = {
            ...card.job,
            status: 'paused',
            error: card.job.id
              ? '页面已刷新，可继续查询此任务'
              : '未取得任务号，请在供应商后台确认提交状态',
          };
      }
      return card;
    });
  const title = typeof saved.title === 'string' ? saved.title.slice(0, 100) : fallback.title;
  return {
    version: 1,
    title: title === '森林来信' && !cards.length ? fallback.title : title,
    cards,
    selected:
      typeof saved.selected === 'string' && cards.some(card => card.id === saved.selected)
        ? saved.selected
        : null,
    sequence: saved.sequence
      .filter(
        shot => shot && typeof shot.id === 'string' && cards.some(card => card.id === shot.cardId),
      )
      .map(shot => ({
        id: shot.id,
        cardId: shot.cardId,
        duration: clamp(Number(shot.duration) || 4, 1, 15),
      })),
    camera: {
      x: Number.isFinite(saved.camera?.x) ? saved.camera!.x : fallback.camera.x,
      y: Number.isFinite(saved.camera?.y) ? saved.camera!.y : fallback.camera.y,
      zoom: Number.isFinite(saved.camera?.zoom)
        ? clamp(saved.camera!.zoom, 0.15, 4)
        : fallback.camera.zoom,
    },
  };
}

export function restoreProject(input: unknown): ProjectState {
  const value: ProjectState = restoreWorkspace(input);
  if (!input || typeof input !== 'object' || (input as ProjectState).version !== 1) return value;
  const saved = input as ProjectState;
  value.workflow = restoreWorkflow(saved.workflow);
  value.consistency = normalizeConsistency(saved.consistency, value.cards);
  if (Array.isArray(saved.checkpoints))
    value.checkpoints = saved.checkpoints
      .slice(-8)
      .filter(
        checkpoint =>
          checkpoint &&
          typeof checkpoint.id === 'string' &&
          typeof checkpoint.name === 'string' &&
          checkpoint.state?.version === 1,
      )
      .map(checkpoint => ({
        id: checkpoint.id,
        name: checkpoint.name.slice(0, 80),
        createdAt: Number(checkpoint.createdAt) || 0,
        state: restoreWorkspace(checkpoint.state),
      }));
  return value;
}
