import type { AIConfig, Card, ProjectState } from '../../types';
import { freeSpot, STEP_X } from '../canvas/canvas-layout';
import { encodeReference } from '../generation/consistency';
import type {
  EngineImageRequest,
  EngineOutcome,
  EngineVideoRequest,
} from '../generation/useEngineTasks';
import { formatYuan, quote } from '../generation/pricing';
import { AgentCommandError } from './agent-bridge';
import { cardDataUrl, soundDataUrl } from './media-data';

export type GenerateDeps = {
  project: ProjectState;
  engine: {
    run: (request: EngineImageRequest, signal: AbortSignal) => Promise<EngineOutcome>;
    runVideo: (request: EngineVideoRequest, signal: AbortSignal) => Promise<EngineOutcome>;
  } | null;
  config: AIConfig;
  toast: (message: string) => void;
};

const text = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value.trim())
    throw new AgentCommandError('INVALID_ARGS', `缺少${name}`);
  return value.trim();
};
const ids = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

function cardsOf(project: ProjectState, list: string[], kind?: Card['kind']) {
  return list.map(id => {
    const card = project.cards.find(item => item.id === id);
    if (!card) throw new AgentCommandError('NO_CARD', `没有这张卡片：${id}`);
    if (card.missingMedia || (card.job?.status && card.job.status !== 'succeeded'))
      throw new AgentCommandError('CARD_NOT_READY', `「${card.name}」还没生成好或素材缺失`);
    if (kind && card.kind !== kind)
      throw new AgentCommandError(
        'INVALID_ARGS',
        `「${card.name}」不是${kind === 'image' ? '图片' : '视频'}`,
      );
    return card;
  });
}

function ready(deps: GenerateDeps) {
  if (!deps.engine) throw new AgentCommandError('NO_ENGINE', '生成任务只在帧外桌面版里可用');
  if (!deps.config.key)
    throw new AgentCommandError('NEEDS_KEY', '帧外还没连接生成服务，请用户先在设置里填 Key');
  return deps.engine;
}

/** Where a new card goes: the given spot, or the first free one right of `near`. */
function spot(project: ProjectState, args: Record<string, unknown>, near?: Card) {
  const x = num(args.x);
  const y = num(args.y);
  if (x !== undefined && y !== undefined) return { x, y };
  const start = near ? { x: near.x + STEP_X, y: near.y } : { x: 0, y: 0 };
  return freeSpot(project.cards, start);
}

/** Starts a generation and answers at once with the new card; the agent waits with wait_card. */
function start(
  deps: GenerateDeps,
  run: (onCard: (id: string) => void) => Promise<EngineOutcome>,
  what: string,
) {
  let cardId = '';
  void run(id => (cardId = id)).then(
    outcome => deps.toast(outcome.ok ? `Claude 的${what}已生成` : outcome.message),
    (error: Error) => deps.toast(error.message),
  );
  if (!cardId) throw new AgentCommandError('FAILED', `${what}没有开始`);
  return cardId;
}

/** generate_image: Seedream with up to 14 reference cards; the prompt names them 图1… in order. */
export async function generateImage(deps: GenerateDeps, args: Record<string, unknown>) {
  const prompt = text(args.prompt, '提示词');
  const references = cardsOf(deps.project, ids(args.references), 'image');
  const config = {
    ...deps.config,
    ...(typeof args.size === 'string' ? { imageSize: args.size } : {}),
  };
  const price = quote(config, 'image', references.length);
  if (args.dryRun) return { estimatedYuan: price, note: '只报价，未生成' };
  const engine = ready(deps);
  const encoded = await Promise.all(references.map(card => encodeReference(card)));
  const cardId = start(
    deps,
    onCard =>
      engine.run(
        {
          text: prompt,
          prompt,
          references: encoded,
          config,
          at: spot(deps.project, args, references[0]),
          label: references.length ? `AI 生成图片 · 参考 ${references.length}` : 'AI 生成图片',
          ...(references.length ? { referenceIds: references.map(card => card.id) } : {}),
          onCard,
        },
        new AbortController().signal,
      ),
    '图片',
  );
  deps.toast(`Claude 开始生成图片${price !== null ? `（约 ${formatYuan(price)}）` : ''}`);
  return { cardId, estimatedYuan: price };
}

/**
 * generate_video: either from a first frame, or (Ark) with reference images and sound clips
 * the prompt names as @图像N and @音频N, in the order given. Sound clips are cut from videos.
 */
export async function generateVideo(deps: GenerateDeps, args: Record<string, unknown>) {
  const prompt = text(args.prompt, '提示词');
  const [first] = cardsOf(deps.project, ids(args.firstFrame ? [args.firstFrame] : []), 'image');
  const images = cardsOf(deps.project, ids(args.images), 'image');
  const sounds = (Array.isArray(args.sounds) ? args.sounds : []).map(raw => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const [card] = cardsOf(deps.project, ids([item.cardId]), 'video');
    return { card, from: num(item.from) ?? 0, length: num(item.length) ?? 5 };
  });
  if (first && (images.length || sounds.length))
    throw new AgentCommandError(
      'INVALID_ARGS',
      '首帧和参考图/参考音频不能同时用；要定首帧，请在提示词里写「以 @图像1 作为首帧」',
    );
  const config: AIConfig = {
    ...deps.config,
    ...(num(args.duration) ? { duration: Math.round(num(args.duration)!) } : {}),
    ...(typeof args.ratio === 'string' ? { videoRatio: args.ratio } : {}),
    ...(typeof args.resolution === 'string' ? { resolution: args.resolution } : {}),
  };
  const price = quote(config, 'video');
  if (args.dryRun) return { estimatedYuan: price, note: '只报价，未生成' };
  const engine = ready(deps);
  const reference = first ? await cardDataUrl(first) : undefined;
  const encoded = await Promise.all(images.map(card => encodeReference(card)));
  const audios = await Promise.all(
    sounds.map(item => soundDataUrl(item.card, item.from, item.length)),
  );
  const cardId = start(
    deps,
    onCard =>
      engine.runVideo(
        {
          text: prompt,
          prompt,
          reference,
          images: encoded,
          audios,
          referenceIds: images.map(card => card.id),
          source: first,
          config,
          at: spot(deps.project, args, first ?? images[0]),
          onCard,
        },
        new AbortController().signal,
      ),
    '视频',
  );
  deps.toast(`Claude 开始生成视频${price !== null ? `（约 ${formatYuan(price)}）` : ''}`);
  return { cardId, estimatedYuan: price };
}

/** card_status: whether a generation has finished, failed or is still running. */
export function cardStatus(project: ProjectState, id: unknown) {
  const card = project.cards.find(item => item.id === id);
  if (!card) throw new AgentCommandError('NO_CARD', `没有这张卡片：${String(id)}`);
  const status = card.job?.status ?? (card.missingMedia ? 'missing' : 'ready');
  return {
    cardId: card.id,
    kind: card.kind,
    status: status === 'succeeded' ? 'ready' : status,
    ...(card.job?.error ? { error: card.job.error } : {}),
    ...(card.duration ? { seconds: card.duration } : {}),
  };
}
