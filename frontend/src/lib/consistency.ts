import type { Card, Consistency, ProjectState, Provider } from '../types';

export const MAX_REFERENCES = 4;
export const MAX_NOTES = 1000;
// Longest side sent to the provider: enough for faces and costume detail, small enough for the relay.
const REFERENCE_EDGE = 1536;

export const usableReference = (card?: Card): card is Card => Boolean(card && card.kind === 'image' && !card.missingMedia && !card.job);

/** Valid, de-duplicated settings; references must point at existing image cards. */
export function normalizeConsistency(input: unknown, cards: Card[]): Consistency | undefined {
  if (!input || typeof input !== 'object') return;
  const value = input as Partial<Consistency>;
  const notes = typeof value.notes === 'string' ? value.notes.trim().slice(0, MAX_NOTES) : '';
  const images = new Set(cards.filter(card => card.kind === 'image').map(card => card.id));
  const references = Array.isArray(value.references) ? [...new Set(value.references.filter((id): id is string => typeof id === 'string' && images.has(id)))].slice(0, MAX_REFERENCES) : [];
  return notes || references.length ? { notes, references } : undefined;
}

export function referenceCards(project: Pick<ProjectState, 'cards' | 'consistency'>): Card[] {
  return (project.consistency?.references ?? []).map(id => project.cards.find(card => card.id === id)).filter(usableReference);
}

export function withNotes(prompt: string, notes = ''): string {
  return notes.trim() ? `${prompt}\n\n统一设定（所有镜头保持一致）：${notes.trim()}` : prompt;
}

/** Official OpenAI and Volcano Ark accept reference images; other services only get the notes. */
export const supportsReferences = (provider: Provider) => provider === 'openai' || provider === 'ark';

/** Reads a card's image and re-encodes it as a JPEG data URL no larger than REFERENCE_EDGE. */
export async function encodeReference(card: Card, signal?: AbortSignal): Promise<string> {
  const response = await fetch(card.src, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`参考图「${card.name}」无法读取`);
  const bitmap = await createImageBitmap(await response.blob()).catch(() => { throw new Error(`参考图「${card.name}」不是可用的图片`); });
  try {
    const scale = Math.min(1, REFERENCE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(16, Math.round(bitmap.width * scale)); canvas.height = Math.max(16, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.88);
  } finally { bitmap.close(); }
}
