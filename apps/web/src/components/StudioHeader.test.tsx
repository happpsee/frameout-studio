import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import StudioHeader from './StudioHeader';

afterEach(cleanup);

describe('studio header', () => {
  it('names the project export honestly and explains what it leaves out', () => {
    const onExportProject = vi.fn();
    render(
      <StudioHeader
        title="未命名项目"
        saveStatus="已保存"
        hasShots
        workflowOpen={false}
        onHome={() => {}}
        onHelp={() => {}}
        onToggleWorkflow={() => {}}
        onSettings={() => {}}
        onExportProject={onExportProject}
        onExportVideo={() => {}}
        onPreview={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name: '导出项目文件' });
    expect(button.getAttribute('title')).toContain('不含图片和视频');
    expect(button.getAttribute('title')).toContain('还不能导回来');
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      button.getAttribute('title'),
    );
    expect(screen.queryByRole('button', { name: '导出项目' })).toBeNull();
    fireEvent.click(button);
    expect(onExportProject).toHaveBeenCalledOnce();
  });
});
