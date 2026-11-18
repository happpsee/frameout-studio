import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';
import type { Card, SoundClip } from '../../types';
import { exportSupported } from './export-support';
import {
  probeClipSound,
  SequenceAudio,
  type ClipSound,
  type ExportAudio,
  type Overlay,
} from './export-audio';
import { soundsBetween } from './sound-clips';

// Renders the sequence the way the preview shows it (same fit, crop and tone, videos
// from their first frame, holding the last frame) and encodes it as an MP4 with WebCodecs.
// Video shots keep their clip's own sound (see export-audio); image shots are silent.

export type ExportShot = { card: Card; duration: number };
export type ExportSize = { width: number; height: number };
type ExportResult = { blob: Blob; audio: ExportAudio };
export type { ExportAudio };
type ExportOptions = ExportSize & {
  fps?: number;
  /** Sound placed on the film, each with the video it is taken from. */
  sounds?: { clip: SoundClip; card: Card }[];
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
};

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

const TONES: Record<string, string> = {
  cool: 'saturate(.65) hue-rotate(17deg) brightness(.91)',
  warm: 'saturate(.85) sepia(.18) brightness(1.1)',
};

/** Frame start times (seconds, within the shot) for a shot of the given length. */
export function shotFrameTimes(duration: number, fps: number): number[] {
  return Array.from({ length: Math.max(1, Math.round(duration * fps)) }, (_, index) => index / fps);
}

/** Parses a CSS object-position such as "50% 20%" or "left top" into fractions. */
export function objectPosition(value = ''): { x: number; y: number } {
  const keywords: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const parse = (part: string | undefined) => {
    if (!part) return 0.5;
    if (part in keywords) return keywords[part];
    const percent = /^(-?\d+(?:\.\d+)?)%$/.exec(part);
    if (percent) return Number(percent[1]) / 100;
    return part === '0' ? 0 : 0.5;
  };
  // A single vertical keyword ("top") applies to y; anything else reads x first.
  if (parts.length === 1 && (parts[0] === 'top' || parts[0] === 'bottom'))
    return { x: 0.5, y: parse(parts[0]) };
  return { x: parse(parts[0]), y: parse(parts[1]) };
}

/** Destination rectangle for CSS object-fit contain/cover with an object-position. */
export function fitRect(
  source: ExportSize,
  target: ExportSize,
  fit: 'contain' | 'cover',
  position = { x: 0.5, y: 0.5 },
) {
  const scale =
    fit === 'contain'
      ? Math.min(target.width / source.width, target.height / source.height)
      : Math.max(target.width / source.width, target.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    x: (target.width - width) * position.x,
    y: (target.height - height) * position.y,
    width,
    height,
  };
}

type Prepared =
  | { kind: 'image'; shot: ExportShot; bitmap: ImageBitmap }
  // track is null when WebCodecs cannot decode the clip; frames then come from a <video> element.
  | {
      kind: 'video';
      shot: ExportShot;
      blob: Blob;
      input: Input;
      track: InputVideoTrack | null;
      last: number;
      sound: ClipSound;
      audio: InputAudioTrack | null;
    };
class Unreadable extends Error {}
class Undecodable extends Error {}

async function loadBlob(card: Card, signal?: AbortSignal): Promise<Blob> {
  // blob:, data: and provider https links; the latter need CORS to be readable.
  const response = await fetch(card.src, {
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.blob();
}

async function prepare(shot: ExportShot, signal?: AbortSignal): Promise<Prepared> {
  let blob: Blob;
  try {
    blob = await loadBlob(shot.card, signal);
  } catch {
    throw new Unreadable();
  }
  if (shot.card.kind !== 'video') {
    try {
      return { kind: 'image', shot, bitmap: await createImageBitmap(blob) };
    } catch {
      throw new Undecodable();
    }
  }
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Undecodable();
    const last = Math.max(0, (await input.computeDuration()) - 0.001);
    const { track: audio, sound } = await probeClipSound(input);
    return {
      kind: 'video',
      shot,
      blob,
      input,
      track: (await track.canDecode()) ? track : null,
      last,
      sound,
      audio,
    };
  } catch {
    input.dispose();
    throw new Undecodable();
  }
}

type SoundSource = { input: Input | null; track: InputAudioTrack | null; sound: ClipSound };
/** Opens each video that film sound clips take sound from; one that can't be read stays silent. */
async function openSounds(cards: Card[], signal?: AbortSignal) {
  const sources = new Map<string, SoundSource>();
  for (const card of cards) {
    if (sources.has(card.id)) continue;
    try {
      const input = new Input({
        source: new BlobSource(await loadBlob(card, signal)),
        formats: ALL_FORMATS,
      });
      sources.set(card.id, { input, ...(await probeClipSound(input)) });
    } catch {
      sources.set(card.id, { input: null, track: null, sound: 'undecodable' });
    }
  }
  return sources;
}

/** Where each film sound clip falls in the shot spanning `start` to `end` seconds of the film. */
function soundOverlays(
  sounds: { clip: SoundClip; card: Card }[],
  sources: Map<string, SoundSource>,
  start: number,
  end: number,
): Overlay[] {
  return soundsBetween(
    sounds.map(item => item.clip),
    start,
    end,
  ).map(part => {
    const card = sounds.find(item => item.clip.id === part.clip.id)!.card;
    const source = sources.get(card.id);
    return {
      name: `${card.name} 的声音`,
      track: source?.sound === 'ok' ? source.track : null,
      offset: part.offset,
      from: part.from,
      length: part.length,
      mode: part.clip.mode,
      volume: part.clip.volume,
    };
  });
}

function once(target: EventTarget, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      target.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      target.removeEventListener(type, done);
      reject(new Undecodable());
    };
    target.addEventListener(type, done, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

/** Seeks a <video> element to each time; slower than WebCodecs but plays whatever the preview plays. */
async function* elementFrames(blob: Blob, times: number[]): AsyncGenerator<HTMLVideoElement> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    const loaded = once(video, 'loadeddata');
    video.src = url;
    await loaded;
    for (const time of times) {
      if (Math.abs(video.currentTime - time) > 0.0005) {
        const seeked = once(video, 'seeked');
        video.currentTime = time;
        await seeked;
      }
      yield video;
    }
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function exportSequence(
  shots: ExportShot[],
  { width, height, fps = 30, signal, onProgress, sounds = [] }: ExportOptions,
): Promise<ExportResult> {
  if (!shots.length) throw new ExportError('成片里还没有可导出的镜头');
  if (!exportSupported())
    throw new ExportError('当前浏览器不支持视频编码，请使用最新版 Chrome、Edge 或桌面版');
  const codec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width, height });
  if (!codec) throw new ExportError(`当前设备无法编码 ${width}×${height} 的视频，请换一个清晰度`);

  // Read every shot before encoding so a broken link fails fast, naming the shots.
  const prepared: Prepared[] = [];
  const unreadable: string[] = [];
  const undecodable: string[] = [];
  const settled = await Promise.allSettled(shots.map(shot => prepare(shot, signal)));
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') prepared.push(result.value);
    else
      (result.reason instanceof Undecodable ? undecodable : unreadable).push(
        shots[index].card.name,
      );
  });
  const soundSources = await openSounds(
    sounds.map(item => item.card),
    signal,
  );
  const release = () => {
    prepared.forEach(item => {
      if (item.kind === 'image') item.bitmap.close();
      else item.input.dispose();
    });
    soundSources.forEach(source => source.input?.dispose());
  };
  if (signal?.aborted) {
    release();
    throw new DOMException('已取消导出', 'AbortError');
  }
  if (unreadable.length || undecodable.length) {
    release();
    const reasons = [
      unreadable.length &&
        `${unreadable.join('、')} 的素材无法读取，供应商临时链接可能已过期或不允许读取，请下载后重新导入`,
      undecodable.length &&
        `${undecodable.join('、')} 的格式无法解码，请转成 MP4（H.264）后重新导入`,
    ].filter(Boolean);
    throw new ExportError(reasons.join('；') + '。');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: fps });
  const total = shots.reduce((sum, shot) => sum + shotFrameTimes(shot.duration, fps).length, 0);
  let written = 0;

  const draw = (image: CanvasImageSource, size: ExportSize, card: Card) => {
    context.filter = 'none';
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    context.filter = TONES[card.tone ?? ''] ?? 'none';
    const rect = fitRect(
      size,
      { width, height },
      card.provider ? 'contain' : 'cover',
      objectPosition(card.crop),
    );
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  };
  const add = async () => {
    if (signal?.aborted) throw new DOMException('已取消导出', 'AbortError');
    await source.add(written / fps, 1 / fps);
    written++;
    if (written % 10 === 0 || written === total) onProgress?.(written / total);
  };

  const frames = async (item: Prepared) => {
    const times = shotFrameTimes(item.shot.duration, fps);
    if (item.kind === 'image') {
      for (const _ of times) {
        draw(item.bitmap, item.bitmap, item.shot.card);
        await add();
      }
      return;
    }
    // Past the clip's end the last frame is held, as in the preview.
    const clipTimes = times.map(time => Math.min(time, item.last));
    if (!item.track) {
      for await (const video of elementFrames(item.blob, clipTimes)) {
        draw(video, { width: video.videoWidth, height: video.videoHeight }, item.shot.card);
        await add();
      }
      return;
    }
    const sink = new CanvasSink(item.track, { poolSize: 2 });
    let previous: HTMLCanvasElement | OffscreenCanvas | null = null;
    for await (const frame of sink.canvasesAtTimestamps(clipTimes)) {
      const image: HTMLCanvasElement | OffscreenCanvas | null = frame?.canvas ?? previous;
      if (image) {
        draw(image, image, item.shot.card);
        previous = image;
      } else {
        context.fillStyle = '#000';
        context.fillRect(0, 0, width, height);
      }
      await add();
    }
  };

  try {
    const { audio, kind: audioKind } = await SequenceAudio.attach(output, [
      ...prepared.map(item => (item.kind === 'video' ? item.sound : 'none')),
      ...[...soundSources.values()].map(source => source.sound),
    ]);
    await output.start();
    for (const item of prepared) {
      const start = written / fps;
      await frames(item);
      // The shot's sound follows its frames and spans exactly them.
      await audio?.write(
        item.kind === 'video'
          ? { name: item.shot.card.name, track: item.audio, sound: item.sound }
          : { name: item.shot.card.name, track: null, sound: 'none' },
        start,
        written / fps,
        signal,
        soundOverlays(sounds, soundSources, start, written / fps),
      );
    }
    await output.finalize();
    return {
      blob: new Blob([output.target.buffer!], { type: 'video/mp4' }),
      audio:
        audioKind === 'kept' ? { kind: 'kept', silent: audio?.silent ?? [] } : { kind: audioKind },
    };
  } catch (error) {
    if (output.state !== 'finalized' && output.state !== 'canceled')
      await output.cancel().catch(() => {});
    throw error;
  } finally {
    release();
  }
}
