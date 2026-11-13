import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import StudioHeader from './StudioHeader';

function renderHeader(onRename = vi.fn()) {
  render(
    <StudioHeader
      title="未命名项目"
      onRename={onRename}
      saveStatus="已保存"
      hasShots={false}
      workflowOpen={false}
      onHome={() => {}}
      onHelp={() => {}}
      onToggleWorkflow={() => {}}
      onSettings={() => {}}
      onExportProject={() => {}}
      onExportVideo={() => {}}
      onPreview={() => {}}
    />,
  );
  return onRename;
}
const editTitle = () => {
  fireEvent.click(screen.getByRole('button', { name: /项目名称：未命名项目/ }));
  return screen.getByRole('textbox', { name: '项目名称' }) as HTMLInputElement;
};

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

  it('renames the project inline: Enter saves, Esc cancels, leaving the field saves', () => {
    const onRename = renderHeader();
    let input = editTitle();
    expect(input.value).toBe('未命名项目');
    expect(input.maxLength).toBe(40);
    fireEvent.change(input, { target: { value: '海边短片' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenLastCalledWith('海边短片');
    expect(screen.queryByRole('textbox')).toBeNull();

    input = editTitle();
    fireEvent.change(input, { target: { value: '不要了' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox')).toBeNull();

    input = editTitle();
    fireEvent.change(input, { target: { value: '夜游' } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenLastCalledWith('夜游');
    expect(onRename).toHaveBeenCalledTimes(2);
  });

  it('does not rename when the name is left as it was', () => {
    const onRename = renderHeader();
    const input = editTitle();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).not.toHaveBeenCalled();
  });
});
