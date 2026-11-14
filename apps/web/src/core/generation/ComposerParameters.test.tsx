import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ComposerParameters from './ComposerParameters';
import { defaults } from '../../shell/settings/preferences';

afterEach(cleanup);

describe('composer picture parameters', () => {
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
});
