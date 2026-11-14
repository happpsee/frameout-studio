// Choices shown in the model dropdowns and the generation parameter pickers.
// Model IDs here must match ones the adapters in packages/shared/src/ai-client.ts already handle.
import { PROVIDERS } from '@frameout/shared';
import type { AIConfig, Provider } from '../../types';

export type ModelKind = 'image' | 'video';
type Option = { value: string; label: string };
type KnownModel = { id: string; name: string; note: string };

const KNOWN_MODELS: Readonly<Record<Provider, Record<ModelKind, readonly KnownModel[]>>> = {
  openai: {
    image: [
      { id: 'gpt-image-1.5', name: 'GPT Image 1.5', note: '推荐，用参考图时更能保住人物长相' },
      { id: 'gpt-image-2', name: 'GPT Image 2', note: '新一代图片模型' },
    ],
    video: [],
  },
  ark: {
    image: [
      {
        id: 'doubao-seedream-5-0-pro-260628',
        name: 'Seedream 5.0 Pro',
        note: '推荐，画质好，可用参考图',
      },
    ],
    video: [
      {
        id: 'doubao-seedance-2-5-260628',
        name: 'Seedance 2.5',
        note: '推荐，可从文字或首帧图生成视频',
      },
    ],
  },
  // The compatible endpoint takes any model name the service provides; it keeps a text field.
  compatible: { image: [], video: [] },
};

/** Whether the provider's models are picked from a list rather than typed in. */
export const hasModelList = (provider: Provider) => provider !== 'compatible';

/** Dropdown options for a provider's models; a saved model not in the list stays selectable. */
export function modelOptions(provider: Provider, kind: ModelKind, current: string): Option[] {
  const options = KNOWN_MODELS[provider][kind].map(model => ({
    value: model.id,
    label: `${model.name} · ${model.note}`,
  }));
  if (current && !options.some(option => option.value === current))
    options.push({ value: current, label: `当前：${current}` });
  return options;
}

const withCurrent = (values: readonly string[], current: string) =>
  current && !values.includes(current) ? [current, ...values] : [...values];

function sizeLabel(value: string) {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) return value;
  const [width, height] = [Number(match[1]), Number(match[2])];
  const shape = width > height ? '横图' : width < height ? '竖图' : '方图';
  return `${width}×${height} ${shape}`;
}

const RATIO_LABELS: Record<string, string> = {
  '16:9': '16:9 横屏',
  '9:16': '9:16 竖屏',
  '1:1': '1:1 方形',
};

/** Picker options for image size, video duration, ratio and resolution. */
export function parameterOptions(config: AIConfig) {
  const preset = PROVIDERS[config.provider];
  // The compatible video adapter only maps 16:9 / 9:16 at 720p or 1080p.
  const compatible = config.provider === 'compatible';
  const ratios = compatible ? ['16:9', '9:16'] : ['16:9', '9:16', '1:1'];
  const resolutions = compatible ? ['720p', '1080p'] : ['480p', '720p', '1080p'];
  const durations = preset.videoDurations.length ? preset.videoDurations : ['5'];
  return {
    sizes: withCurrent(preset.imageSizes, config.imageSize).map(value => ({
      value,
      label: sizeLabel(value),
    })),
    durations: withCurrent(durations, String(config.duration)).map(value => ({
      value,
      label: `${value} 秒`,
    })),
    ratios: withCurrent(ratios, config.videoRatio).map(value => ({
      value,
      label: RATIO_LABELS[value] || value,
    })),
    resolutions: withCurrent(resolutions, config.resolution).map(value => ({
      value,
      label: value,
    })),
  };
}
