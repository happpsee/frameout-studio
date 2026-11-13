import type { Card } from '../types';
import { CARD_HEIGHT, CARD_WIDTH } from './canvas-camera';
import { EXAMPLE_LABEL, uid } from './project';

export interface StudioExample {
  id: 'forest' | 'ocean' | 'city';
  name: string;
  /** Images under /assets/, added to the canvas in this order. */
  images: { file: string; name: string }[];
  /** Next step put in the prompt box: a motion description for "图生视频". */
  prompt: string;
}

/** The landing page's three starting points, opened as sample material on the canvas. */
export const STUDIO_EXAMPLES: readonly StudioExample[] = [
  {
    id: 'forest',
    name: '森林来信',
    images: [{ file: 'forest-astronaut.webp', name: '森林来信 · 薄雾森林' }],
    prompt: '镜头缓缓推近，探索者拨开薄雾向森林深处走去，阳光从树梢间洒下',
  },
  {
    id: 'ocean',
    name: '潮汐之后',
    images: [{ file: 'still-ocean.webp', name: '潮汐之后 · 蓝绿浪花' }],
    prompt: '海浪一层层涌上来又退去，镜头贴着水面慢慢平移，浪花在阳光下闪光',
  },
  {
    id: 'city',
    name: '夜游计划',
    images: [{ file: 'still-city.webp', name: '夜游计划 · 夜色城市' }],
    prompt: '镜头沿着街道缓缓向前，霓虹灯光在湿润的路面上流动，行人匆匆走过',
  },
];

export const findExample = (id: string) => STUDIO_EXAMPLES.find(example => example.id === id);

// The landing page and the studio are siblings; the request waits here until the studio opens.
let requested: StudioExample['id'] | null = null;
export function requestExample(id: StudioExample['id']) {
  requested = id;
}
/** The pending example, left in place for the studio to take. */
export function peekExampleRequest(): StudioExample | undefined {
  return requested ? findExample(requested) : undefined;
}
/** Returns the pending example once, then clears it. */
export function takeExampleRequest(): StudioExample | undefined {
  const id = requested;
  requested = null;
  return id ? findExample(id) : undefined;
}

const exampleSource = (file: string) => '/assets/' + file;
const GAP = 80;

/**
 * Cards for an example, placed to the right of everything already on the canvas so nothing
 * is covered. Images already added from this example are reused instead of duplicated.
 * `fallback` is where the first card goes on an empty canvas.
 */
export function exampleCards(
  example: StudioExample,
  existing: readonly Card[],
  fallback: { x: number; y: number },
): { added: Card[]; cards: Card[] } {
  const reused = new Map(
    existing.filter(card => card.label === EXAMPLE_LABEL).map(card => [card.src, card] as const),
  );
  const missing = example.images.filter(image => !reused.has(exampleSource(image.file)));
  const origin = existing.length
    ? {
        x: Math.max(...existing.map(card => card.x)) + CARD_WIDTH + GAP,
        y: Math.min(...existing.map(card => card.y)),
      }
    : fallback;
  const added = missing.map((image, index): Card => ({
    id: uid(),
    // A column, so videos generated from these land to the right of them.
    x: origin.x,
    y: origin.y + index * (CARD_HEIGHT + GAP / 2),
    name: image.name,
    kind: 'image',
    src: exampleSource(image.file),
    tone: 'normal',
    label: EXAMPLE_LABEL,
  }));
  const fresh = new Map(added.map(card => [card.src, card]));
  const cards = example.images.map(
    image => reused.get(exampleSource(image.file)) ?? fresh.get(exampleSource(image.file))!,
  );
  return { added, cards };
}
