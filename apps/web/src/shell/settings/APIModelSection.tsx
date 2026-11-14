import type { AIConfig } from '../../types';
import { PROVIDERS } from '@frameout/shared';
import { hasModelList, parameterOptions } from './model-options';
import { isDesktop } from '../../platform';
import ModelField from './ModelField';
import Select from '../../ui/Select';

/** API settings, section 02: model choice. Desktop also keeps the picture parameters here. */
export default function APIModelSection({
  draft,
  patch,
}: {
  draft: AIConfig;
  patch: <K extends keyof AIConfig>(name: K, value: AIConfig[K]) => void;
}) {
  const preset = PROVIDERS[draft.provider];
  // The web composer has its own pickers; desktop also shows them in the right-hand panel.
  const parameters = isDesktop() ? parameterOptions(draft) : null;
  // A dropdown names itself; only the compatible text field needs the label tied to it.
  const labelFor = (id: string) => (hasModelList(draft.provider) ? undefined : id);
  return (
    <section className="fo-api-section">
      <strong className="fo-api-section-title">
        {parameters ? '02 / 模型与画面参数' : '02 / 模型'}
      </strong>
      <div className="fo-api-grid">
        <div className="fo-api-field">
          <label htmlFor={labelFor('image-model')}>图片模型</label>
          <ModelField
            id="image-model"
            label="图片模型"
            provider={draft.provider}
            kind="image"
            value={draft.imageModel}
            onChange={value => patch('imageModel', value)}
          />
        </div>
        {parameters && (
          <div className="fo-api-field">
            <label>图片尺寸</label>
            <Select
              label="图片尺寸"
              value={draft.imageSize}
              onChange={value => patch('imageSize', value)}
              options={parameters.sizes}
            />
          </div>
        )}
        {preset.canVideo && (
          <div className="fo-api-field">
            <label htmlFor={labelFor('video-model')}>视频模型</label>
            <ModelField
              id="video-model"
              label="视频模型"
              provider={draft.provider}
              kind="video"
              value={draft.videoModel}
              onChange={value => patch('videoModel', value)}
            />
          </div>
        )}
        {preset.canVideo && parameters && (
          <>
            <div className="fo-api-field">
              <label>视频时长</label>
              <Select
                label="视频时长"
                value={String(draft.duration)}
                onChange={value => patch('duration', Number(value))}
                options={parameters.durations}
              />
            </div>
            <div className="fo-api-field">
              <label>视频比例</label>
              <Select
                label="视频比例"
                value={draft.videoRatio}
                onChange={value => patch('videoRatio', value)}
                options={parameters.ratios}
              />
            </div>
            <div className="fo-api-field">
              <label>视频分辨率</label>
              <Select
                label="视频分辨率"
                value={draft.resolution}
                onChange={value => patch('resolution', value)}
                options={parameters.resolutions}
              />
            </div>
          </>
        )}
      </div>
      <p className="fo-api-capability-note">
        {draft.provider === 'openai'
          ? '此配置用于图片生成。生成视频请使用火山方舟或支持视频协议的兼容服务。'
          : preset.note}
        {!parameters && ' 尺寸、时长、比例在输入框旁边调整。'}
      </p>
    </section>
  );
}
