import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Landing from './Landing';
import { takeExampleRequest } from '../lib/examples';

const disconnected = vi.fn();

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      media: query,
      matches: query.includes('prefers-reduced-motion'),
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = disconnected;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('React landing navigation', () => {
  it('opens the same workspace from each creation button', () => {
    const onOpen = vi.fn();
    render(<Landing onOpenStudio={onOpen} />);
    const entries = [
      screen.getByRole('button', { name: '开始创作' }),
      ...screen.getAllByRole('button', { name: '打开创作画布' }),
      screen.getByRole('button', { name: '进去动手试试' }),
    ];
    entries.forEach(entry => fireEvent.click(entry));
    expect(onOpen.mock.calls).toEqual(entries.map(() => []));
  });

  it('opens each showcase example in the studio, without a video preview', () => {
    const onOpen = vi.fn();
    render(<Landing onOpenStudio={onOpen} />);
    const showcase = screen.getByRole('region', { name: /先从一个/ });
    expect(within(showcase).getByRole('img', { name: '夜色城市的光影' })).toBeTruthy();
    const examples = within(showcase).getAllByRole('button');
    expect(examples.map(button => button.getAttribute('aria-label'))).toEqual([
      '打开示例「森林来信」',
      '打开示例「潮汐之后」',
      '打开示例「夜游计划」',
    ]);
    fireEvent.click(examples[2]);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(takeExampleRequest()?.id).toBe('city');
    expect(screen.queryByRole('button', { name: /观看.*动态预览/ })).toBeNull();
  });

  it('says who it is for and what to prepare, in Chinese rather than English display text', () => {
    const { container } = render(<Landing onOpenStudio={() => {}} />);
    const fit = screen.getByText(/适合想自己挑画面、排镜头的创作者/);
    expect(fit.textContent).toMatch(/火山方舟或 OpenAI 的 API\s*Key，按次付费/);
    expect(fit.textContent).toContain('导出的成片保留视频自带的声音');
    expect(screen.getByRole('heading', { level: 1, name: '拍一场好戏。' })).toBeTruthy();
    // Only the brand and the "API" acronym stay in capitals.
    const text = (container.textContent ?? '').replace(/FRAMEOUT|API/g, '');
    expect(text).not.toMatch(/[A-Z]{3,}/);
  });

  it('disconnects the scroll observer when leaving the page', () => {
    const { unmount } = render(<Landing onOpenStudio={() => {}} />);
    unmount();
    expect(disconnected).toHaveBeenCalled();
  });
});
