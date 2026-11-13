import type { AIConfig } from '../types';
import { PROVIDERS } from '../lib/ai-client';
import { parameterOptions } from '../lib/model-options';
import Select from './Select';
import '../styles/composer-parameters.css';

/** Web composer: the picture settings for the current mode, right next to the prompt. */
export default function ComposerParameters({
  config,
  video,
  disabled,
  onChange,
  onSettings,
}: {
  config: AIConfig;
  video: boolean;
  disabled: boolean;
  onChange: (config: AIConfig) => void;
  onSettings: () => void;
}) {
  const { sizes, durations, ratios, resolutions } = parameterOptions(config);
  const patch = <K extends keyof AIConfig>(key: K, value: AIConfig[K]) =>
    onChange({ ...config, [key]: value });
  if (video && !PROVIDERS[config.provider].canVideo)
    return (
      <button
        type="button"
        className="fo-composer-param-note"
        onClick={onSettings}
        disabled={disabled}
      >
        {PROVIDERS[config.provider].label} 不能生成视频，去换服务
      </button>
    );
  const field = (
    label: string,
    value: string,
    options: { value: string; label: string }[],
    change: (value: string) => void,
  ) => (
    <Select
      className="fo-composer-param"
      label={label}
      value={value}
      options={options}
      onChange={change}
      disabled={disabled}
    />
  );
  return (
    <div className="fo-composer-params" role="group" aria-label="画面参数">
      {video ? (
        <>
          {field('视频时长', String(config.duration), durations, value =>
            patch('duration', Number(value)),
          )}
          {field('视频比例', config.videoRatio, ratios, value => patch('videoRatio', value))}
          {field('视频分辨率', config.resolution, resolutions, value => patch('resolution', value))}
        </>
      ) : (
        field('图片尺寸', config.imageSize, sizes, value => patch('imageSize', value))
      )}
    </div>
  );
}
