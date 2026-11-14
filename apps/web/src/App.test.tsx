// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { initialState } from './core/project/project';
import {
  DESKTOP_INTRO_KEY,
  PROJECT_STORAGE_KEY,
  PROJECTS_INDEX_KEY,
  flushDesktopStorage,
  loadDesktopStorage,
} from './core/project/desktop-storage';
import { createProject, findProject, listProjects, projectDataKeys } from './core/project/projects';
import { requestExample } from './shell/misc/examples';
import type { ProjectState } from './types';

vi.mock('./shell/landing/Landing', () => ({
  default: ({ onOpenStudio }: { onOpenStudio: () => void }) => (
    <section aria-label="产品介绍">
      <button type="button" onClick={() => onOpenStudio()}>
        进入画布
      </button>
      <button
        type="button"
        onClick={() => {
          requestExample('forest');
          onOpenStudio();
        }}
      >
        打开示例
      </button>
    </section>
  ),
}));
// The real list is built separately; this stand-in only needs the same props and store.
vi.mock('./shell/lobby/Lobby', async () => {
  const projects = await import('./core/project/projects');
  const { useSyncExternalStore } = await import('react');
  return {
    default: function Lobby({
      onOpenProject,
      onShowIntro,
    }: {
      onOpenProject: (id: string) => void;
      onShowIntro: () => void;
    }) {
      const list = useSyncExternalStore(projects.subscribeProjects, projects.listProjects);
      return (
        <section aria-label="项目大厅">
          {list.map(project => (
            <button type="button" key={project.id} onClick={() => onOpenProject(project.id)}>
              打开项目：{project.title}
            </button>
          ))}
          <button type="button" onClick={() => onOpenProject(projects.createProject().id)}>
            新建项目
          </button>
          <button type="button" onClick={onShowIntro}>
            查看介绍
          </button>
        </section>
      );
    },
  };
});
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
function frame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(fn => fn(performance.now()));
  });
}
const encode = (value: string) => new TextEncoder().encode(value).buffer;
const canvas = () => screen.queryByRole('main', { name: '无限创作画布' });
const lobby = () => screen.queryByRole('region', { name: '项目大厅' });
const intro = () => screen.queryByRole('region', { name: '产品介绍' });
const renderApp = () =>
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
function savedProject(edit: (project: ProjectState) => void) {
  const project = initialState();
  edit(project);
  return JSON.stringify(project);
}
const forestCard = {
  id: 'saved-forest',
  name: '穿过森林',
  src: 'https://example.test/forest.webp',
  kind: 'image' as const,
  x: 170,
  y: 165,
};
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

describe('desktop navigation', () => {
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
  async function openFromLobby(name: string) {
    await act(async () => fireEvent.click(screen.getByRole('button', { name })));
    frame();
    frame();
  }

  it('shows the introduction only on the first launch, then the project list', async () => {
    const files = new Map<string, ArrayBuffer>();
    await desktopSession(files);
    history.replaceState(null, '', '/#studio');
    const first = renderApp();
    expect(intro()).toBeTruthy();
    expect(canvas()).toBeNull();
    await flushDesktopStorage();
    expect(new TextDecoder().decode(files.get(DESKTOP_INTRO_KEY))).toBe('seen');
    first.unmount();
    history.replaceState(null, '', '/');
    await desktopSession(files);
    renderApp();
    expect(lobby()).toBeTruthy();
    expect(intro()).toBeNull();
    await openFromLobby('新建项目');
    expect(canvas()).toBeTruthy();
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(canvas()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回项目列表' }));
    expect(lobby()).toBeTruthy();
    expect(canvas()).toBeNull();
    await flushDesktopStorage();
  });

  it('opens the workspace saved before projects, with its assets, from the list', async () => {
    const files = new Map<string, ArrayBuffer>([
      [DESKTOP_INTRO_KEY, encode('seen')],
      [
        PROJECT_STORAGE_KEY,
        encode(
          savedProject(project => {
            project.title = '我的旧作品';
            project.cards = [{ ...forestCard, name: '森林素材' }];
          }),
        ),
      ],
    ]);
    await desktopSession(files);
    render(<App />);
    await openFromLobby('打开项目：我的旧作品');
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
    fireEvent.click(screen.getByRole('button', { name: '返回项目列表' }));
    // Versions are written first, then the project.
    await act(async () => {
      await flushDesktopStorage();
      await new Promise(resolve => setTimeout(resolve, 0));
      await flushDesktopStorage();
    });
    const [project] = listProjects();
    expect(project).toMatchObject({ title: '我的旧作品', shotCount: 1, durationSeconds: 4 });
    const saved = JSON.parse(
      new TextDecoder().decode(files.get(projectDataKeys(project.id).project)),
    );
    expect(saved.sequence).toHaveLength(1);
    // The pre-project file is left untouched as a backup.
    expect(JSON.parse(new TextDecoder().decode(files.get(PROJECT_STORAGE_KEY))).sequence).toEqual(
      [],
    );
    expect(files.has(PROJECTS_INDEX_KEY)).toBe(true);
  });

  it('goes back to the list with a message when a project file cannot be read', async () => {
    const files = new Map<string, ArrayBuffer>([[DESKTOP_INTRO_KEY, encode('seen')]]);
    await desktopSession(files);
    const project = createProject('坏掉的项目');
    await flushDesktopStorage();
    files.set(projectDataKeys(project.id).project, encode('{damaged'));
    await desktopSession(files);
    renderApp();
    await openFromLobby('打开项目：坏掉的项目');
    expect(canvas()).toBeNull();
    expect(lobby()).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('项目读取失败');
    expect(new TextDecoder().decode(files.get(projectDataKeys(project.id).project))).toBe(
      '{damaged',
    );
  });
});

describe('web navigation', () => {
  it('introduces first-time visitors, then opens a first project from the introduction', () => {
    renderApp();
    expect(intro()).toBeTruthy();
    expect(location.hash).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '进入画布' }));
    frame();
    frame();
    const [project] = listProjects();
    expect(project.title).toBe('未命名项目');
    expect(location.hash).toBe(`#studio/${project.id}`);
    expect(canvas()).toBeTruthy();
    expect(localStorage.getItem(DESKTOP_INTRO_KEY)).toBe('seen');
    expect(document.body.dataset.studio).toBe('true');
    cleanup();
    history.replaceState(null, '', '/');
    renderApp();
    expect(lobby()).toBeTruthy();
    expect(document.body.dataset.studio).toBeUndefined();
  });

  it('opens an example from the introduction as a new project named after it', () => {
    localStorage.setItem(DESKTOP_INTRO_KEY, 'seen');
    const mine = createProject('我的项目');
    history.replaceState(null, '', '/#intro');
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: '打开示例' }));
    frame();
    frame();
    expect(canvas()).toBeTruthy();
    const example = listProjects().find(project => project.title === '森林来信')!;
    expect(location.hash).toBe(`#studio/${example.id}`);
    expect(screen.getByRole('button', { name: '选择素材：森林来信 · 薄雾森林' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回项目列表' }));
    expect(findProject(example.id)?.cardCount).toBe(1);
    expect(findProject(mine.id)?.cardCount).toBe(0);
  });

  it('keeps the in-page key, unfinished prompt, camera and undo history after visiting the list', () => {
    localStorage.setItem(DESKTOP_INTRO_KEY, 'seen');
    const project = createProject('森林');
    localStorage.setItem(
      projectDataKeys(project.id).project,
      savedProject(value => {
        value.title = '森林';
        value.cards = [forestCard];
      }),
    );
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: '打开项目：森林' }));
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
    fireEvent.click(screen.getByRole('button', { name: '返回项目列表' }));
    frame();
    expect((document.querySelector('#studio-root') as HTMLElement).hidden).toBe(true);
    expect(findProject(project.id)).toMatchObject({ shotCount: 1, durationSeconds: 4 });
    fireEvent.keyDown(document, { key: 'z', code: 'KeyZ', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: '打开项目：森林' }));
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

  it('keeps each project separate: contents, prompt and undo history', () => {
    localStorage.setItem(DESKTOP_INTRO_KEY, 'seen');
    const a = createProject('甲');
    const b = createProject('乙');
    localStorage.setItem(
      projectDataKeys(a.id).project,
      savedProject(value => {
        value.title = '甲';
        value.cards = [forestCard];
      }),
    );
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: '打开项目：甲' }));
    frame();
    frame();
    fireEvent.change(screen.getByRole('textbox', { name: '让想法，先有一个画面。' }), {
      target: { value: '甲的提示词' },
    });
    fireEvent.click(screen.getByRole('button', { name: '选择素材：穿过森林' }));
    fireEvent.click(screen.getByRole('button', { name: '加入成片' }));
    fireEvent.click(screen.getByRole('button', { name: '返回项目列表' }));
    fireEvent.click(screen.getByRole('button', { name: '打开项目：乙' }));
    frame();
    frame();
    expect(screen.getAllByRole('main', { name: '无限创作画布' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '选择素材：穿过森林' })).toBeNull();
    expect(
      (screen.getByRole('textbox', { name: '让想法，先有一个画面。' }) as HTMLTextAreaElement)
        .value,
    ).toBe('');
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '返回项目列表' }));
    const savedA = JSON.parse(localStorage.getItem(projectDataKeys(a.id).project)!);
    const savedB = JSON.parse(localStorage.getItem(projectDataKeys(b.id).project)!);
    expect(savedA.sequence).toHaveLength(1);
    expect(savedB).toMatchObject({ title: '乙', cards: [], sequence: [] });
    expect(listProjects().map(project => project.title)).toEqual(['甲', '乙']);
  });
});
