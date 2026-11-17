import { PROVIDER_CAPABILITIES } from '@frameout/shared';
import type { Card, Consistency, ProjectState, Provider, ReferenceRole } from '../../types';

export const MAX_REFERENCES = 4;
export const MAX_NOTES = 1000;
// Longest side sent to the provider: enough for faces and costume detail, small enough for the relay.
const REFERENCE_EDGE = 1536;

export const usableReference = (card?: Card): card is Card =>
  Boolean(card && card.kind === 'image' && !card.missingMedia && !card.job);

/** Valid, de-duplicated settings; references must point at existing image cards. */
export function normalizeConsistency(input: unknown, cards: Card[]): Consistency | undefined {
  if (!input || typeof input !== 'object') return;
  const value = input as Partial<Consistency>;
  const notes = typeof value.notes === 'string' ? value.notes.trim().slice(0, MAX_NOTES) : '';
  const images = new Set(cards.filter(card => card.kind === 'image').map(card => card.id));
  const references = Array.isArray(value.references)
    ? [
        ...new Set(
          value.references.filter((id): id is string => typeof id === 'string' && images.has(id)),
        ),
      ].slice(0, MAX_REFERENCES)
    : [];
  return notes || references.length ? { notes, references } : undefined;
}

export function referenceCards(project: Pick<ProjectState, 'cards' | 'consistency'>): Card[] {
  return (project.consistency?.references ?? [])
    .map(id => project.cards.find(card => card.id === id))
    .filter(usableReference);
}

export const REFERENCE_ROLES: Record<ReferenceRole, { label: string; guide: string }> = {
  character: { label: '角色', guide: '角色，保持长相、发型和服装一致' },
  scene: { label: '场景', guide: '场景，保持环境和光线一致' },
  prop: { label: '道具', guide: '道具，保持外形一致' },
  style: { label: '风格', guide: '只参考画风和色调' },
};
const ROLE_ORDER: (ReferenceRole | undefined)[] = [
  undefined,
  'character',
  'scene',
  'prop',
  'style',
];
/** The next choice when the role button is pressed; after the last one it is unset again. */
export const nextRole = (role?: ReferenceRole) =>
  ROLE_ORDER[(ROLE_ORDER.indexOf(role) + 1) % ROLE_ORDER.length];
export const validRole = (role: unknown): role is ReferenceRole =>
  typeof role === 'string' && role in REFERENCE_ROLES;

/**
 * Tells the model what each reference image is for, in the order the images are sent.
 * Says nothing when no reference has a role, so untagged projects send the prompt as before.
 */
export function withReferenceRoles(prompt: string, references: Card[]): string {
  if (!references.some(card => card.role)) return prompt;
  const lines = references.map((card, index) =>
    card.role ? `参考图 ${index + 1}：${REFERENCE_ROLES[card.role].guide}` : '',
  );
  return `${prompt}\n\n${lines.filter(Boolean).join('；')}`;
}

/** The shared notes go first: image models weigh the start of a prompt most. */
export function withNotes(prompt: string, notes = ''): string {
  return notes.trim() ? `统一设定（所有镜头保持一致）：${notes.trim()}\n\n${prompt}` : prompt;
}

/** Official OpenAI and Volcano Ark accept reference images; other services only get the notes. */
export const supportsReferences = (provider: Provider) =>
  PROVIDER_CAPABILITIES[provider].references;

/** Reads a card's image and re-encodes it as a JPEG data URL no larger than REFERENCE_EDGE. */
export async function encodeReference(card: Card, signal?: AbortSignal): Promise<string> {
  const response = await fetch(card.src, {
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error(`参考图「${card.name}」无法读取`);
  const bitmap = await createImageBitmap(await response.blob()).catch(() => {
    throw new Error(`参考图「${card.name}」不是可用的图片`);
  });
  try {
    const scale = Math.min(1, REFERENCE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(16, Math.round(bitmap.width * scale));
    canvas.height = Math.max(16, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.88);
  } finally {
    bitmap.close();
  }
}
