import {
  AudioBufferSink,
  AudioBufferSource,
  getFirstEncodableAudioCodec,
  QUALITY_HIGH,
  type Input,
  type InputAudioTrack,
  type Output,
} from 'mediabunny';
import { exportAudioSupported } from './export-support';

// The exported sound track: each video shot keeps its clip's own sound from the clip's start,
// cut to the shot's length; image shots, and the held last frame past a clip's end, are silent.
// Everything is resampled to one fixed format and written shot by shot, so only one shot's
// decoded sound is held in memory at a time.

export const AUDIO_RATE = 48000;
export const AUDIO_CHANNELS = 2;
// Silence is written in pieces of at most this many seconds.
const SILENCE_PIECE = 5;

/** What a clip offers: no sound track, sound this browser can decode, or sound it cannot. */
export type ClipSound = 'none' | 'ok' | 'undecodable';
/** How the export ended up with sound. `silent` names the shots whose sound could not be read. */
export type ExportAudio =
  { kind: 'none' } | { kind: 'unsupported' } | { kind: 'kept'; silent: string[] };

/** Audio frames between two timeline positions, rounded at both ends so shots never drift apart. */
export function framesBetween(start: number, end: number, rate = AUDIO_RATE): number {
  return Math.max(0, Math.round(end * rate) - Math.round(start * rate));
}

/**
 * Where a decoded piece of a clip (starting at clip time `timestamp`, `frames` long at `rate`)
 * goes in a shot buffer `total` frames long: the frame it lands on, the frame of the piece to
 * copy from, and how many frames. Null when the piece falls outside the shot.
 */
export function placeFrames(
  timestamp: number,
  frames: number,
  rate: number,
  total: number,
): { at: number; from: number; count: number } | null {
  const start = Math.round(timestamp * rate);
  const at = Math.max(0, start);
  const from = at - start;
  const count = Math.min(frames - from, total - at);
  return count > 0 ? { at, from, count } : null;
}

/** Whether the export gets a sound track, given what each shot's clip offers. */
export function planAudio(clips: ClipSound[], canEncode: boolean): ExportAudio['kind'] {
  if (clips.every(clip => clip === 'none')) return 'none';
  if (!canEncode || !clips.includes('ok')) return 'unsupported';
  return 'kept';
}

/** Finds a clip's sound track and whether this browser can decode it. */
export async function probeClipSound(
  input: Input,
): Promise<{ track: InputAudioTrack | null; sound: ClipSound }> {
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return { track: null, sound: 'none' };
    if (exportAudioSupported() && (await track.canDecode())) return { track, sound: 'ok' };
    return { track: null, sound: 'undecodable' };
  } catch {
    return { track: null, sound: 'undecodable' };
  }
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('已取消导出', 'AbortError');
}

/** Decodes the clip's sound from its start and mixes it into one shot-long buffer in the export format. */
async function renderClip(track: InputAudioTrack, frames: number, signal?: AbortSignal) {
  const length = frames / AUDIO_RATE;
  // Pieces are first joined at the clip's own rate, so resampling has no seams between them.
  let joined: AudioBuffer | null = null;
  for await (const piece of new AudioBufferSink(track).buffers(0, length)) {
    aborted(signal);
    const { sampleRate, numberOfChannels } = piece.buffer;
    joined ??= new AudioBuffer({
      length: Math.ceil(length * sampleRate),
      numberOfChannels,
      sampleRate,
    });
    const place = placeFrames(piece.timestamp, piece.buffer.length, sampleRate, joined.length);
    if (!place) continue;
    for (let channel = 0; channel < Math.min(numberOfChannels, joined.numberOfChannels); channel++)
      joined.copyToChannel(
        piece.buffer.getChannelData(channel).subarray(place.from, place.from + place.count),
        channel,
        place.at,
      );
  }
  const context = new OfflineAudioContext(AUDIO_CHANNELS, frames, AUDIO_RATE);
  if (joined) {
    // The context resamples to the export rate and up- or down-mixes to stereo.
    const node = context.createBufferSource();
    node.buffer = joined;
    node.connect(context.destination);
    node.start(0);
  }
  return context.startRendering();
}

/** Writes the sound track shot by shot, in step with the video frames. */
export class SequenceAudio {
  readonly silent: string[] = [];
  private readonly source: AudioBufferSource;
  private constructor(source: AudioBufferSource) {
    this.source = source;
  }

  /** Adds a sound track to the output when some clip has sound this browser can handle. */
  static async attach(
    output: Output,
    clips: ClipSound[],
  ): Promise<{ audio: SequenceAudio | null; kind: ExportAudio['kind'] }> {
    const codec = clips.some(clip => clip === 'ok')
      ? await getFirstEncodableAudioCodec(['aac', 'opus'], {
          numberOfChannels: AUDIO_CHANNELS,
          sampleRate: AUDIO_RATE,
          quality: QUALITY_HIGH,
        }).catch(() => null)
      : null;
    const kind = planAudio(clips, codec !== null);
    if (kind !== 'kept' || !codec) return { audio: null, kind };
    const source = new AudioBufferSource({ codec, quality: QUALITY_HIGH });
    output.addAudioTrack(source);
    return { audio: new SequenceAudio(source), kind };
  }

  /** Writes the shot that spans `start` to `end` on the timeline: its clip's sound, or silence. */
  async write(
    shot: { name: string; track: InputAudioTrack | null; sound: ClipSound },
    start: number,
    end: number,
    signal?: AbortSignal,
  ) {
    const frames = framesBetween(start, end);
    if (!frames) return;
    if (shot.track && shot.sound === 'ok') {
      let rendered: AudioBuffer | null = null;
      try {
        rendered = await renderClip(shot.track, frames, signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
      }
      if (rendered) {
        await this.source.add(rendered);
        return;
      }
    }
    if (shot.sound !== 'none') this.silent.push(shot.name);
    for (let left = frames; left > 0; left -= SILENCE_PIECE * AUDIO_RATE) {
      aborted(signal);
      const length = Math.min(left, SILENCE_PIECE * AUDIO_RATE);
      await this.source.add(
        new AudioBuffer({ length, numberOfChannels: AUDIO_CHANNELS, sampleRate: AUDIO_RATE }),
      );
    }
  }
}
