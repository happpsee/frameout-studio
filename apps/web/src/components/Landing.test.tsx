import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Landing from './Landing';

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

  it('keeps reference imagery on the landing page without a sample import or video preview', () => {
    render(<Landing onOpenStudio={() => {}} />);
    const showcase = screen.getByRole('region', { name: /先从一个/ });
    expect(within(showcase).getByRole('img', { name: '夜色城市的光影' })).toBeTruthy();
    expect(within(showcase).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /观看.*动态预览/ })).toBeNull();
  });

  it('disconnects the scroll observer when leaving the page', () => {
    const { unmount } = render(<Landing onOpenStudio={() => {}} />);
    unmount();
    expect(disconnected).toHaveBeenCalled();
  });
});
