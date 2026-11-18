import type { Card } from '../../types';

/** A card's whole file as a data URL (a first frame is sent at full size). */
export async function cardDataUrl(card: Card): Promise<string> {
  const blob = await (await fetch(card.src)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`「${card.name}」读取失败`));
    reader.readAsDataURL(blob);
  });
}

/** 16-bit PCM WAV of a decoded buffer: what Ark takes as a reference audio clip. */
export function wavBytes(buffer: AudioBuffer): Uint8Array {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = new Uint8Array(44 + frames * channels * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) =>
    [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * channels * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  const data = [...Array(channels)].map((_, channel) => buffer.getChannelData(channel));
  let at = 44;
  for (let frame = 0; frame < frames; frame++)
    for (const samples of data) {
      const sample = Math.max(-1, Math.min(1, samples[frame]));
      view.setInt16(at, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      at += 2;
    }
  return bytes;
}

const RATE = 24_000;

/**
 * `length` seconds of a video's sound from second `from`, as a WAV data URL. Ark takes 2 to 30
 * seconds per clip; mono at 24 kHz keeps 30 seconds under 1.5 MB.
 */
export async function soundDataUrl(card: Card, from: number, length: number): Promise<string> {
  if (card.kind !== 'video') throw new Error('只能从视频卡片取声音');
  const seconds = Math.min(30, Math.max(2, length));
  const encoded = await (await fetch(card.src)).arrayBuffer();
  const decoder = new OfflineAudioContext(1, RATE, RATE);
  const decoded = await decoder.decodeAudioData(encoded).catch(() => {
    throw new Error(`「${card.name}」没有可读取的声音`);
  });
  const context = new OfflineAudioContext(1, Math.round(seconds * RATE), RATE);
  const node = context.createBufferSource();
  node.buffer = decoded;
  node.connect(context.destination);
  node.start(0, Math.max(0, from), seconds);
  const clip = await context.startRendering();
  let binary = '';
  const bytes = wavBytes(clip);
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(binary)}`;
}
