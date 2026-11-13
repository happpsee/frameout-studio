import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import HelpDialog from './HelpDialog';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});
afterEach(cleanup);

describe('help dialog', () => {
  it('walks through the first film in three steps before the canvas shortcuts', () => {
    render(<HelpDialog open onClose={() => {}} onShowIntro={() => {}} />);
    const steps = screen.getByRole('region', { name: '三步做出第一条片' });
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('API 设置');
    expect(items[0].textContent).toContain('火山方舟');
    expect(items[0].textContent).toContain('API Key 管理');
    expect(items[1].textContent).toContain('图生视频');
    expect(items[2].textContent).toContain('加入成片');
    expect(items[2].textContent).toContain('导出成片');
    const shortcuts = screen.getByText('平移画布');
    expect(
      steps.compareDocumentPosition(shortcuts) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
