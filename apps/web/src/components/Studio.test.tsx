// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Studio from './Studio';
import { initialState, STORAGE_KEY } from '../lib/project';
import { defaults, saveProfile } from '../lib/preferences';

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
  it('previews a shot plan from the toolbar and persists its dependencies before generation', () => {
    saveProfile({ ...defaults('ark'), key: '' });
    render(<Studio onClose={vi.fn()} />);
    frame();
    frame();
    fireEvent.click(screen.getByRole('button', { name: '镜头计划' }));
    fireEvent.change(screen.getByLabelText('每一行，描述一个镜头'), {
      target: { value: '森林远景\n雨滴特写' },
    });
    fireEvent.click(screen.getByLabelText('图片完成后，接着生成视频'));
    fireEvent.click(screen.getByRole('button', { name: '预览计划' }));
    expect(screen.getByText('0 / 4')).toBeTruthy();
    expect(screen.getByText('等待步骤 1 的图片完成')).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存版本并开始生成' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '生成图片' }).hasAttribute('disabled')).toBe(false);
  });
  it('restores the saved camera and preserves a backup through the version panel', () => {
    const saved = initialState();
    saved.camera = { x: 20, y: 60, zoom: 0.6 };
    saved.checkpoints = [
      {
        id: 'first',
        name: '第一稿',
        createdAt: 1,
        state: { ...initialState(), camera: { x: 30, y: 80, zoom: 0.4 } },
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    render(<Studio onClose={vi.fn()} />);
    frame();
    frame();
    fireEvent.click(screen.getByRole('button', { name: '镜头计划' }));
    fireEvent.click(screen.getByRole('tab', { name: /版本记录/ }));
    fireEvent.click(screen.getByRole('button', { name: '回到这个版本' }));
    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
    frame();
    expect(screen.getByRole('button', { name: '缩放比例选项' }).textContent).toBe('40%');
    expect(screen.getByText('恢复前自动备份')).toBeTruthy();
  });
  it('opens an empty workspace with upload and real generation options, including after a saved demo preference', () => {
    localStorage.setItem('frameout-generation-mode', 'demo');
    render(
      <StrictMode>
        <Studio onClose={vi.fn()} />
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
  it('preserves a saved camera instead of fitting again on entry', () => {
    const saved = initialState();
    saved.camera = { x: -240, y: 60, zoom: 0.6 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const { container } = render(
      <StrictMode>
        <Studio onClose={vi.fn()} />
      </StrictMode>,
    );
    frame();
    frame();
    expect(screen.getByRole('button', { name: '缩放比例选项' }).textContent).toBe('60%');
    expect((container.querySelector('.fo-stage') as HTMLElement).style.transform).toBe(
      'translate3d(-240px,60px,0) scale(0.6)',
    );
  });
  it('uses decoded video duration when adding a clip to the timeline', () => {
    const saved = initialState();
    saved.cards = [
      {
        id: 'clip',
        name: '原片',
        x: 170,
        y: 165,
        src: 'https://media.example/clip.mp4',
        kind: 'video',
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const { container } = render(<Studio onClose={vi.fn()} />);
    frame();
    frame();
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'duration', { value: 5.166667 });
    fireEvent.loadedMetadata(video);
    fireEvent.click(screen.getByRole('button', { name: '选择素材：原片' }));
    fireEvent.click(screen.getByRole('button', { name: '加入成片' }));
    expect(screen.getByRole('combobox', { name: '原片的播放时长' }).textContent).toBe('5.17 秒');
    expect(screen.getByText('1 个镜头 · 00:05')).toBeTruthy();
  });
  it('changes timeline duration by keyboard and keeps it in sync after undo/redo', () => {
    saveWorkspaceWithMedia();
    render(<Studio onClose={vi.fn()} />);
    frame();
    frame();
    fireEvent.click(screen.getByRole('button', { name: '选择素材：穿过森林' }));
    fireEvent.click(screen.getByRole('button', { name: '加入成片' }));
    const duration = screen.getByRole('combobox', { name: '穿过森林的播放时长' });
    fireEvent.keyDown(duration, { key: 'ArrowDown' });
    const list = screen.getByRole('listbox', { name: '穿过森林的播放时长' });
    fireEvent.keyDown(within(list).getByRole('option', { name: '4 秒' }), { key: 'ArrowDown' });
    fireEvent.keyDown(within(list).getByRole('option', { name: '5 秒' }), { key: 'Enter' });
    expect(duration.textContent).toBe('5 秒');
    expect(screen.getByText('1 个镜头 · 00:05')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(duration.textContent).toBe('4 秒');
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(duration.textContent).toBe('5 秒');
  });
  it('reorders shots, removes them and restores removal with undo', () => {
    saveWorkspaceWithMedia();
    const { container } = render(<Studio onClose={vi.fn()} />);
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
  it('ignores global shortcuts and canvas input while hidden, then resumes the same workspace', () => {
    saveWorkspaceWithMedia();
    const { container, rerender } = render(<Studio onClose={vi.fn()} />);
    frame();
    frame();
    fireEvent.change(screen.getByRole('textbox', { name: '让想法，先有一个画面。' }), {
      target: { value: '还没说完的镜头' },
    });
    fireEvent.click(screen.getByRole('button', { name: '选择素材：穿过森林' }));
    fireEvent.click(screen.getByRole('button', { name: '加入成片' }));
    const viewport = container.querySelector('.fo-viewport')!;
    const stage = container.querySelector('.fo-stage') as HTMLElement;
    const cameraBefore = stage.style.transform;
    rerender(<Studio onClose={vi.fn()} active={false} />);
    expect((container.querySelector('#studio-root') as HTMLElement).hidden).toBe(true);
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'Delete' });
    fireEvent.keyDown(document, { key: 'h' });
    const wheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    fireEvent(viewport, wheel);
    frame();
    expect(wheel.defaultPrevented).toBe(false);
    rerender(<Studio onClose={vi.fn()} active />);
    frame();
    frame();
    expect(screen.getAllByRole('button', { name: /^选择素材：/ })).toHaveLength(3);
    expect(screen.getByText('1 个镜头 · 00:04')).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: '让想法，先有一个画面。' }) as HTMLTextAreaElement)
        .value,
    ).toBe('还没说完的镜头');
    expect(screen.getByRole('button', { name: '选择工具' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(stage.style.transform).toBe(cameraBefore);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByText('0 个镜头 · 00:00')).toBeTruthy();
  });
  it('stops a pending generation on deactivation while retaining its unfinished prompt', async () => {
    let reply!: (value: Response) => void;
    const generate = vi.fn(
      (_path: string, _options: RequestInit) =>
        new Promise<Response>(resolve => {
          reply = resolve;
        }),
    );
    vi.stubGlobal('fetch', generate);
    const { rerender } = render(<Studio onClose={vi.fn()} />);
    frame();
    frame();
    fireEvent.click(screen.getByRole('button', { name: 'API 设置' }));
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'fixture-in-memory-only' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^保存配置/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '让想法，先有一个画面。' }), {
      target: { value: '等回来再继续' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
    expect(generate).toHaveBeenCalledOnce();
    const [path, options] = generate.mock.calls[0];
    expect(path).toBe('/api/ai');
    expect(options.signal?.aborted).toBe(false);
    expect((screen.getByRole('button', { name: '生成图片' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    rerender(<Studio onClose={vi.fn()} active={false} />);
    expect(options.signal?.aborted).toBe(true);
    await act(async () =>
      reply(new Response(JSON.stringify({ data: [{ url: 'https://media.example/late.png' }] }))),
    );
    rerender(<Studio onClose={vi.fn()} active />);
    frame();
    expect(screen.queryAllByRole('button', { name: /^选择素材：/ })).toHaveLength(0);
    expect(
      (screen.getByRole('textbox', { name: '让想法，先有一个画面。' }) as HTMLTextAreaElement)
        .value,
    ).toBe('等回来再继续');
    expect((screen.getByRole('button', { name: '生成图片' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
  it('sends a first generation without a key to the API settings and keeps the prompt', () => {
    render(<Studio onClose={vi.fn()} />);
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
    render(<Studio onClose={vi.fn()} />);
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
  it('marks an image as a reference, keeps shared notes, and forgets a deleted reference', () => {
    const project = initialState();
    project.cards = [
      {
        id: 'hero',
        x: 170,
        y: 165,
        name: '主角',
        kind: 'image',
        src: 'https://media.example/hero.png',
        provider: 'ark',
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    render(<Studio onClose={vi.fn()} />);
    frame();
    frame();
    expect(screen.getByRole('button', { name: '镜头一致性：未设定' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '选择素材：主角' }));
    fireEvent.click(screen.getByRole('button', { name: '设为参考' }));
    expect(screen.getByText('参考')).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消参考' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '镜头一致性：未设定 · 参考 1' }));
    const dialog = screen.getByRole('dialog', { name: '镜头一致性' });
    expect(within(dialog).getByText('主角')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('统一设定'), {
      target: { value: '红色雨衣，黑色短发' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /完成/ }));
    expect(screen.getByRole('button', { name: '镜头一致性：已设定 · 参考 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除选中素材' }));
    expect(screen.getByRole('button', { name: '镜头一致性：已设定' })).toBeTruthy();
  });
});
