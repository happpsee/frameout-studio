import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ComposerParameters from './ComposerParameters';
import DesktopGenerationSettings from './DesktopGenerationSettings';
import { defaults } from '../lib/preferences';
import { modelOptions } from '../lib/model-options';

afterEach(cleanup);

describe('composer picture parameters', () => {
  it('shows only the image size for images', () => {
    render(
      <ComposerParameters
        config={defaults('ark')}
        video={false}
        disabled={false}
        onChange={() => {}}
        onSettings={() => {}}
      />,
    );
    expect(screen.getByRole('combobox', { name: '图片尺寸' }).textContent).toBe('2K');
    expect(screen.queryByRole('combobox', { name: '视频时长' })).toBeNull();
  });

  it('shows duration, ratio and resolution for videos and saves the change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const config = defaults('ark');
    render(
      <ComposerParameters
        config={config}
        video
        disabled={false}
        onChange={onChange}
        onSettings={() => {}}
      />,
    );
    expect(screen.queryByRole('combobox', { name: '图片尺寸' })).toBeNull();
    expect(screen.getByRole('combobox', { name: '视频时长' }).textContent).toBe('5 秒');
    expect(screen.getByRole('combobox', { name: '视频分辨率' }).textContent).toBe('720p');
    await user.click(screen.getByRole('combobox', { name: '视频比例' }));
    await user.click(screen.getByRole('option', { name: /9:16 竖屏/ }));
    expect(onChange).toHaveBeenCalledWith({ ...config, videoRatio: '9:16' });
  });

  it('sends users to settings when the service cannot make videos', async () => {
    const user = userEvent.setup();
    const onSettings = vi.fn();
    render(
      <ComposerParameters
        config={defaults('openai')}
        video
        disabled={false}
        onChange={() => {}}
        onSettings={onSettings}
      />,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    await user.click(screen.getByRole('button', { name: /不能生成视频/ }));
    expect(onSettings).toHaveBeenCalled();
  });

  it('keeps unknown values selectable instead of hiding them', () => {
    render(
      <ComposerParameters
        config={{ ...defaults('openai'), imageSize: '2048x2048' }}
        video={false}
        disabled={false}
        onChange={() => {}}
        onSettings={() => {}}
      />,
    );
    expect(screen.getByRole('combobox', { name: '图片尺寸' }).textContent).toBe('2048×2048 方图');
  });
});

describe('model choices', () => {
  it('lists known models and keeps a saved one that is not listed', () => {
    expect(modelOptions('openai', 'image', 'gpt-image-1.5').map(option => option.value)).toEqual([
      'gpt-image-1.5',
      'gpt-image-2',
    ]);
    expect(modelOptions('ark', 'video', 'my-seedance').at(-1)).toEqual({
      value: 'my-seedance',
      label: '当前：my-seedance',
    });
  });

  it('lets desktop pick the model from the same list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const config = defaults('openai');
    render(
      <DesktopGenerationSettings
        config={config}
        video={false}
        disabled={false}
        onChange={onChange}
        onSettings={() => {}}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: '生成模型' }));
    await user.click(screen.getByRole('option', { name: /GPT Image 2/ }));
    expect(onChange).toHaveBeenCalledWith({ ...config, imageModel: 'gpt-image-2' });
  });
});
