// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { initialState, STORAGE_KEY } from './lib/project';
import {
  DESKTOP_INTRO_KEY,
  PROJECT_STORAGE_KEY,
  flushDesktopStorage,
  loadDesktopStorage,
} from './lib/desktop-storage';

vi.mock('./components/Landing', () => ({
  default: ({ onOpenStudio }: { onOpenStudio: () => void }) => (
    <button type="button" onClick={() => onOpenStudio()}>
      进入画布
    </button>
  ),
}));
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
function frame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(fn => fn(performance.now()));
  });
}
beforeEach(() => {
  localStorage.clear();
  frames.clear();
  history.replaceState(null, '', '/');
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++frameId, fn);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: this.classList.contains('fo-composer') ? 650 : 0,
      right: 1200,
      bottom: 800,
      width: 1200,
      height: 800,
      toJSON: () => ({}),
    };
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    if (this.open) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    }
  };
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('workspace navigation', () => {
  async function desktopSession(files: Map<string, ArrayBuffer>) {
    vi.stubGlobal('frameoutDesktop', {
      platform: 'darwin',
      storage: {
        read: async (key: string) => files.get(key) ?? null,
        write: async (key: string, bytes: ArrayBuffer) => {
          files.set(key, bytes);
        },
      },
      onBeforeClose: () => () => {},
    });
    await loadDesktopStorage();
  }

  it('shows the desktop introduction only on the first launch, including if closed before entering', async () => {
    const files = new Map<string, ArrayBuffer>();
    await desktopSession(files);
    history.replaceState(null, '', '/#studio');
    const first = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(screen.getByRole('button', { name: '进入画布' })).toBeTruthy();
    expect(screen.queryByRole('main', { name: '无限创作画布' })).toBeNull();
    await flushDesktopStorage();
    expect(new TextDecoder().decode(files.get(DESKTOP_INTRO_KEY))).toBe('seen');
    first.unmount();
    history.replaceState(null, '', '/');
    await desktopSession(files);
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    frame();
    frame();
    expect(screen.getByRole('main', { name: '无限创作画布' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '进入画布' })).toBeNull();
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(screen.getByRole('main', { name: '无限创作画布' })).toBeTruthy();
  });

  it('keeps the desktop project and prompt when reviewing the introduction from help', async () => {
    const files = new Map<string, ArrayBuffer>([
      [DESKTOP_INTRO_KEY, new TextEncoder().encode('seen').buffer],
    ]);
    await desktopSession(files);
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    frame();
    frame();
    expect(screen.queryByRole('button', { name: '返回 FRAMEOUT 首页' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '提示词' }), {
      target: { value: '继续未完成的镜头' },
    });
    fireEvent.click(screen.getByRole('button', { name: '打开使用指南' }));
    fireEvent.click(screen.getByRole('button', { name: '查看产品介绍' }));
    frame();
    expect(screen.getByRole('button', { name: '进入画布' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '进入画布' }));
    frame();
    frame();
    expect((screen.getByRole('textbox', { name: '提示词' }) as HTMLTextAreaElement).value).toBe(
      '继续未完成的镜头',
    );
    expect(screen.getByRole('main', { name: '无限创作画布' })).toBeTruthy();
    await flushDesktopStorage();
  });

  it('finds a saved desktop asset and expands the sequence when adding a shot', async () => {
    const project = initialState();
    project.cards = [
      {
        id: 'forest',
        name: '森林素材',
        src: 'https://media.example/forest.webp',
        kind: 'image',
        x: 100,
        y: 100,
      },
    ];
    const files = new Map<string, ArrayBuffer>([
      [DESKTOP_INTRO_KEY, new TextEncoder().encode('seen').buffer],
      [PROJECT_STORAGE_KEY, new TextEncoder().encode(JSON.stringify(project)).buffer],
    ]);
    await desktopSession(files);
    render(<App />);
    frame();
    frame();
    expect(screen.getByRole('button', { name: '展开成片' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '项目素材' }));
    fireEvent.click(screen.getByRole('button', { name: '定位素材：森林素材' }));
    frame();
    fireEvent.click(screen.getByRole('button', { name: '加入成片' }));
    expect(screen.getByRole('button', { name: '收起成片' })).toBeTruthy();
    expect(screen.getByText('1 个镜头 · 00:04')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '版本记录' }));
    expect(screen.getByRole('tabpanel', { name: '版本记录' })).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: '项目素材' })).toBeNull();
    await flushDesktopStorage();
  });

  it('retains the in-page key, unfinished prompt, camera and undo history after visiting home', () => {
    const savedProject = initialState();
    savedProject.cards = [
      {
        id: 'saved-forest',
        name: '穿过森林',
        src: 'https://example.test/forest.webp',
        kind: 'image',
        x: 170,
        y: 165,
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedProject));
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole('button', { name: '进入画布' }));
    frame();
    frame();
    fireEvent.change(screen.getByRole('textbox', { name: '让想法，先有一个画面。' }), {
      target: { value: '留到下一次继续的提示词' },
    });
    fireEvent.click(screen.getByRole('button', { name: '选择素材：穿过森林' }));
    fireEvent.click(screen.getByRole('button', { name: '加入成片' }));
    fireEvent.click(screen.getByRole('button', { name: '缩放比例选项' }));
    fireEvent.change(screen.getByRole('textbox', { name: '缩放比例' }), {
      target: { value: '150' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    frame();
    expect(screen.getByRole('button', { name: '缩放比例选项' }).textContent).toBe('150%');
    fireEvent.click(screen.getByRole('button', { name: 'API 设置' }));
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'fixture-in-memory-only' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^保存配置/ }));
    fireEvent.click(screen.getByRole('button', { name: '返回 FRAMEOUT 首页' }));
    frame();
    expect((document.querySelector('#studio-root') as HTMLElement).hidden).toBe(true);
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: '进入画布' }));
    frame();
    frame();
    expect(screen.getByText('1 个镜头 · 00:04')).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: '让想法，先有一个画面。' }) as HTMLTextAreaElement)
        .value,
    ).toBe('留到下一次继续的提示词');
    expect(screen.getByRole('button', { name: '缩放比例选项' }).textContent).toBe('150%');
    fireEvent.click(screen.getByRole('button', { name: 'API 设置' }));
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe(
      'fixture-in-memory-only',
    );
    fireEvent.click(screen.getByRole('button', { name: '关闭 API 设置' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByText('0 个镜头 · 00:00')).toBeTruthy();
    expect(
      Object.keys(localStorage)
        .map(key => localStorage.getItem(key))
        .join(''),
    ).not.toContain('fixture-in-memory-only');
  });
});
