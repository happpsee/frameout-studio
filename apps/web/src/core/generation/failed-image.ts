import type { AIConfig, Card, ProjectState, VideoJob } from '../../types';
import { placeholder, preferenceOnly, uid } from '../project/project';
import { DRAFT_LABEL } from '../canvas/card-links';

// A failed image generation stays on the canvas with its prompt and reason, so it can be read,
// retried with "再来一张" and deleted. It is stored as a card with an ended job: everything that
// skips unfinished media (sequence, references, first frames, export, download) skips it too,
// and project save/load keeps the job, its status and its reason. The label tells it apart
// from a video task, because the job fields kept on save have no room for the kind.
export const FAILED_IMAGE_LABEL = '图片生成失败';
const FAILED_IMAGE_MEDIA = placeholder('图片生成失败');

type FailedImage = Card & { job: VideoJob };

export const failedImage = (card?: Card): card is FailedImage =>
  Boolean(card?.job && card.label === FAILED_IMAGE_LABEL);

export function failedImageCard(
  prompt: string,
  error: string,
  config: AIConfig,
  position: { x: number; y: number },
): FailedImage {
  return {
    id: uid(),
    ...position,
    name: prompt.slice(0, 18),
    prompt,
    src: FAILED_IMAGE_MEDIA,
    kind: 'image',
    provider: config.provider,
    size: config.imageSize,
    label: FAILED_IMAGE_LABEL,
    job: {
      id: '',
      provider: config.provider,
      status: 'failed',
      prompt,
      config: preferenceOnly(config),
      error,
    },
  };
}

/** Turns a card into a failed image in place: same position, prompt kept, reason shown. */
export function markImageFailed(card: Card, error: string, config: AIConfig) {
  Object.assign(card, {
    src: FAILED_IMAGE_MEDIA,
    kind: 'image',
    label: FAILED_IMAGE_LABEL,
    job: {
      id: '',
      provider: config.provider,
      status: 'failed',
      prompt: card.prompt ?? '',
      config: preferenceOnly(config),
      error,
    },
  });
  delete card.mediaId;
}

/**
 * Adds a generated (or failed) image card and selects it. With `replace`, a failed or draft card
 * gives up its place to the new one, and a shot plan step that pointed at it follows along.
 */
export function placeImageCard(draft: ProjectState, card: Card, replace?: string) {
  const old = replace ? draft.cards.find(item => item.id === replace) : undefined;
  // A failed image, or an empty card waiting to be filled, gives its place to the result.
  if (old && (failedImage(old) || old.label === DRAFT_LABEL)) {
    card.x = old.x;
    card.y = old.y;
    draft.cards = draft.cards.filter(item => item.id !== old.id);
    for (const step of draft.workflow?.steps ?? []) {
      if (step.outputCardId !== old.id || step.mode !== 'image') continue;
      step.outputCardId = card.id;
      if (failedImage(card)) {
        step.status = 'failed';
        step.error = card.job.error;
      } else {
        step.status = 'succeeded';
        delete step.error;
      }
    }
  }
  draft.cards.push(card);
  draft.selected = card.id;
}
