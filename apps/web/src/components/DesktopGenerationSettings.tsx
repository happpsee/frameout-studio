import type { AIConfig } from '../types';
import { PROVIDERS } from '../lib/ai-client';
import Icon from './Icon';
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
  const sizes = [...new Set([config.imageSize, ...preset.imageSizes])].map(value => ({
    value,
    label: value,
  }));
  const durations = [...new Set([String(config.duration), ...preset.videoDurations])].map(
    value => ({ value, label: `${value} 秒` }),
  );
  const patch = <K extends keyof AIConfig>(key: K, value: AIConfig[K]) =>
    onChange({ ...config, [key]: value });
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
        <label htmlFor="fo-quick-model">模型</label>
        <input
          id="fo-quick-model"
          value={video ? config.videoModel : config.imageModel}
          placeholder="填写模型名称"
          onChange={event => patch(video ? 'videoModel' : 'imageModel', event.target.value)}
        />
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
                  options={['16:9', '9:16', '1:1'].map(value => ({ value, label: value }))}
                  onChange={value => patch('videoRatio', value)}
                  disabled={disabled || !preset.canVideo}
                />
              </label>
              <label>
                分辨率
                <Select
                  label="生成视频分辨率"
                  value={config.resolution}
                  options={['480p', '720p', '1080p'].map(value => ({ value, label: value }))}
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
