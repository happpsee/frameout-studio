// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Studio from './Studio';
import { initialState } from './project/project';
import { projectDataKeys } from './project/projects';
const TEST_PROJECT = 'test';
const STORAGE_KEY = projectDataKeys(TEST_PROJECT).project;

let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
function frame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(fn => fn(performance.now()));
  });
}
function saveWorkspaceWithMedia() {
  const project = initialState();
  project.cards = ['穿过森林', '光落下的地方', '返航'].map((name, index) => ({
    id: `created-shot-${index}`,
    x: 170 + index * 310,
    y: 165,
    name,
    src: `https://media.example/shot-${index}.png`,
    kind: 'image',
    provider: 'ark',
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}
beforeEach(() => {
  localStorage.clear();
  frames.clear();
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('React studio integration', () => {
  it('opens an empty workspace with upload and real generation options, including after a saved demo preference', () => {
    localStorage.setItem('frameout-generation-mode', 'demo');
    render(
      <StrictMode>
        <Studio projectId="test" onClose={vi.fn()} />
      </StrictMode>,
    );
    frame();
    frame();
    expect(screen.queryAllByRole('button', { name: /^选择素材：/ })).toHaveLength(0);
    expect(screen.getByRole('button', { name: '添加本地素材' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '生成图片' })).toBeTruthy();
    // The web composer keeps the picture size next to the prompt.
    expect(screen.getByRole('combobox', { name: '图片尺寸' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('combobox', { name: '生成模式' }), { key: 'ArrowDown' });
    const modes = within(screen.getByRole('listbox', { name: '生成模式' }));
    expect(modes.getAllByRole('option')).toHaveLength(2);
    expect(modes.getByRole('option', { name: /图片/ })).toBeTruthy();
    expect(modes.getByRole('option', { name: /视频/ })).toBeTruthy();
  });
  it('reorders shots, removes them and restores removal with undo', () => {
    saveWorkspaceWithMedia();
    const { container } = render(<Studio projectId="test" onClose={vi.fn()} />);
    frame();
    frame();
    fireEvent.click(screen.getByRole('button', { name: '选择素材：穿过森林' }));
    fireEvent.click(screen.getByRole('button', { name: '加入成片' }));
    fireEvent.click(screen.getByRole('button', { name: '选择素材：光落下的地方' }));
    fireEvent.click(screen.getByRole('button', { name: '加入成片' }));
    fireEvent.click(screen.getAllByRole('button', { name: '镜头前移' })[1]);
    expect(container.querySelector('.fo-seq-item .fo-seq-detail > span')?.textContent).toBe(
      '光落下的地方',
    );
    fireEvent.click(screen.getAllByRole('button', { name: '从成片移除' })[0]);
    expect(container.querySelectorAll('.fo-seq-item')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(container.querySelectorAll('.fo-seq-item')).toHaveLength(2);
    expect(container.querySelector('.fo-seq-item .fo-seq-detail > span')?.textContent).toBe(
      '光落下的地方',
    );
  });
  it('sends a first generation without a key to the API settings and keeps the prompt', () => {
    render(<Studio projectId="test" onClose={vi.fn()} />);
    frame();
    frame();
    expect(screen.getByRole('button', { name: '连接生成服务' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '让想法，先有一个画面。' }), {
      target: { value: '雨夜街头回头的女孩' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
    expect(screen.getByRole('dialog', { name: '连接你的生成服务' })).toBeTruthy();
    expect(screen.getByText(/先连接一个生成服务。提示词已保留/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('API Key'));
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'fixture-in-memory-only' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^保存配置/ }));
    expect(screen.queryByRole('button', { name: '连接生成服务' })).toBeNull();
    expect(screen.getByText('已连接，提示词还在，点生成即可')).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: '让想法，先有一个画面。' }) as HTMLTextAreaElement)
        .value,
    ).toBe('雨夜街头回头的女孩');
  });
  it('opens the final cut export with the playable shots and explains a missing encoder', () => {
    const project = initialState();
    project.cards = [
      {
        id: 'ready',
        x: 0,
        y: 0,
        name: '雨夜',
        kind: 'image',
        src: 'https://media.example/ready.png',
        provider: 'ark',
      },
      { id: 'lost', x: 300, y: 0, name: '丢失', kind: 'image', src: '', mediaId: 'media-gone' },
    ];
    project.sequence = [
      { id: 's1', cardId: 'ready', duration: 4 },
      { id: 's2', cardId: 'lost', duration: 3 },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    render(<Studio projectId="test" onClose={vi.fn()} />);
    frame();
    frame();
    fireEvent.click(screen.getByRole('button', { name: '导出成片' }));
    const dialog = screen.getByRole('dialog', { name: '导出成片' });
    expect(within(dialog).getByText(/1 个镜头 · 00:04/)).toBeTruthy();
    expect(within(dialog).getByText('另有 1 个镜头素材缺失或未完成，已跳过')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).toContain('不支持视频编码');
    expect(
      (within(dialog).getByRole('button', { name: /开始导出/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭导出' }));
    expect(screen.queryByRole('dialog', { name: '导出成片' })).toBeNull();
  });
});
