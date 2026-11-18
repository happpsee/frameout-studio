import type { Card } from '../../types';

/** Longest side of an image an agent looks at; enough to judge it, small enough to send. */
const VIEW_EDGE = 1024;
const SHEET_FRAMES = 8;

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

const jpeg = (canvas: HTMLCanvasElement) =>
  canvas.toDataURL('image/jpeg', 0.85).slice('data:image/jpeg;base64,'.length);

async function loadVideo(src: string) {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = src;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('视频无法读取'));
  });
  return video;
}

async function seek(video: HTMLVideoElement, seconds: number) {
  video.currentTime = Math.min(Math.max(0, seconds), Math.max(0, video.duration - 0.05));
  await new Promise<void>(resolve => {
    video.onseeked = () => resolve();
  });
}

/**
 * The card as a JPEG an agent can look at: an image scaled down, or a video as a sheet of
 * frames evenly spread over its length, left to right, top to bottom.
 */
export async function viewCard(card: Card) {
  if (card.missingMedia) throw new Error('这张卡片的素材缺失，需要重新导入');
  if (card.kind === 'image') {
    const image = new Image();
    image.src = card.src;
    await image.decode();
    const scale = Math.min(1, VIEW_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = canvasOf(image.naturalWidth * scale, image.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { data: jpeg(canvas), note: `图片 ${image.naturalWidth}×${image.naturalHeight}` };
  }
  const video = await loadVideo(card.src);
  try {
    const columns = 4;
    const rows = Math.ceil(SHEET_FRAMES / columns);
    const cell = Math.min(1, VIEW_EDGE / columns / Math.max(video.videoWidth, video.videoHeight));
    const width = video.videoWidth * cell;
    const height = video.videoHeight * cell;
    const sheet = canvasOf(width * columns, height * rows);
    const context = sheet.getContext('2d')!;
    const times: number[] = [];
    for (let i = 0; i < SHEET_FRAMES; i++) {
      const time = ((i + 0.5) / SHEET_FRAMES) * video.duration;
      times.push(Math.round(time * 10) / 10);
      await seek(video, time);
      context.drawImage(
        video,
        (i % columns) * width,
        Math.floor(i / columns) * height,
        width,
        height,
      );
    }
    return {
      data: jpeg(sheet),
      note: `视频 ${video.videoWidth}×${video.videoHeight}，${Math.round(video.duration * 100) / 100} 秒；${SHEET_FRAMES} 帧依次取自 ${times.join('、')} 秒`,
    };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

/** One frame of a video card, full size, as a PNG file named after the card and the second. */
export async function frameFile(card: Card, seconds: number) {
  if (card.kind !== 'video') throw new Error('只能从视频卡片取帧');
  const video = await loadVideo(card.src);
  try {
    await seek(video, seconds);
    const canvas = canvasOf(video.videoWidth, video.videoHeight);
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('取帧失败');
    const at = Math.round(Math.min(seconds, video.duration) * 100) / 100;
    return new File([blob], `${card.name} · ${at}秒.png`, { type: 'image/png' });
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
