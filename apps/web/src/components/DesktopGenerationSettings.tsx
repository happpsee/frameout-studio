import type { AIConfig } from '../types';
import { PROVIDERS } from '@frameout/shared';
import { hasModelList, parameterOptions } from '../lib/model-options';
import Icon from './Icon';
import ModelField from './ModelField';
import Select from './Select';

export default function DesktopGenerationSettings({
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
  const preset = PROVIDERS[config.provider];
  const { sizes, durations, ratios, resolutions } = parameterOptions(config);
  const patch = <K extends keyof AIConfig>(key: K, value: AIConfig[K]) =>
    onChange({ ...config, [key]: value });
  const model = {
    id: 'fo-quick-model',
    label: '生成模型',
    provider: config.provider,
    kind: video ? ('video' as const) : ('image' as const),
    value: video ? config.videoModel : config.imageModel,
    onChange: (value: string) => patch(video ? 'videoModel' : 'imageModel', value),
    disabled: disabled || (video && !preset.canVideo),
  };
  return (
    <>
      <button
        type="button"
        className="fo-service-connection"
        aria-label="API 设置"
        onClick={onSettings}
      >
        <span>
          <i className={config.key ? 'is-connected' : undefined} />
          {preset.label}
        </span>
        <span>
          {config.key ? '已配置' : '连接服务'}
          <Icon name="settings" />
        </span>
      </button>
      <fieldset className="fo-generation-parameters" disabled={disabled}>
        <legend>生成参数</legend>
        {hasModelList(config.provider) ? (
          <label>
            模型
            <ModelField {...model} />
          </label>
        ) : (
          <>
            <label htmlFor="fo-quick-model">模型</label>
            <ModelField {...model} />
          </>
        )}
        {video ? (
          <>
            <label>
              时长
              <Select
                label="生成视频时长"
                value={String(config.duration)}
                options={durations}
                onChange={value => patch('duration', Number(value))}
                disabled={disabled || !preset.canVideo}
              />
            </label>
            <div className="fo-parameter-row">
              <label>
                画幅
                <Select
                  label="生成视频画幅"
                  value={config.videoRatio}
                  options={ratios}
                  onChange={value => patch('videoRatio', value)}
                  disabled={disabled || !preset.canVideo}
                />
              </label>
              <label>
                分辨率
                <Select
                  label="生成视频分辨率"
                  value={config.resolution}
                  options={resolutions}
                  onChange={value => patch('resolution', value)}
                  disabled={disabled || !preset.canVideo}
                />
              </label>
            </div>
            {!preset.canVideo && (
              <p className="fo-work-note">当前服务仅支持图片。请在 API 设置中连接视频服务。</p>
            )}
          </>
        ) : (
          <label>
            图片尺寸
            <Select
              label="生成图片尺寸"
              value={config.imageSize}
              options={sizes}
              onChange={value => patch('imageSize', value)}
              disabled={disabled}
            />
          </label>
        )}
      </fieldset>
    </>
  );
}
