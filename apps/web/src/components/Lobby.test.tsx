import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectSummary } from '../lib/projects';
import { takeExampleRequest } from '../lib/examples';

const NOW = new Date(2026, 10, 13, 15, 0).getTime();
const MINUTE = 60_000;
const DAY = 86_400_000;

const store = vi.hoisted(() => ({
  projects: [] as ProjectSummary[],
  deleted: [] as ProjectSummary[],
  listeners: new Set<() => void>(),
  nextId: 1,
}));
const notify = () => store.listeners.forEach(listener => listener());

vi.mock('../lib/projects', () => ({
  listProjects: vi.fn(() => [...store.projects]),
  listDeletedProjects: vi.fn(() => [...store.deleted]),
  createProject: vi.fn((title?: string) => {
    const project: ProjectSummary = {
      id: `new-${store.nextId++}`,
      title: title ?? '未命名项目',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cardCount: 0,
      shotCount: 0,
      durationSeconds: 0,
    };
    store.projects.unshift(project);
    store.listeners.forEach(listener => listener());
    return project;
  }),
  renameProject: vi.fn((id: string, title: string) => {
    store.projects = store.projects.map(p => (p.id === id ? { ...p, title } : p));
    store.listeners.forEach(listener => listener());
  }),
  deleteProject: vi.fn((id: string) => {
    const project = store.projects.find(p => p.id === id);
    store.projects = store.projects.filter(p => p.id !== id);
    if (project) store.deleted.unshift({ ...project, deletedAt: Date.now() });
    store.listeners.forEach(listener => listener());
  }),
  restoreDeletedProject: vi.fn((id: string) => {
    const project = store.deleted.find(p => p.id === id);
    store.deleted = store.deleted.filter(p => p.id !== id);
    if (project) store.projects.unshift({ ...project, deletedAt: undefined });
    store.listeners.forEach(listener => listener());
  }),
  purgeDeletedProjects: vi.fn(),
  subscribeProjects: vi.fn((listener: () => void) => {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  }),
}));

vi.mock('../lib/media-store', () => ({
  getMedia: vi.fn(async (id: string) =>
    id === 'media-cover' ? new Blob(['x'], { type: 'image/png' }) : null,
  ),
}));

import * as projects from '../lib/projects';
import { getMedia } from '../lib/media-store';
import Lobby from './Lobby';

function project(overrides: Partial<ProjectSummary> & { id: string }): ProjectSummary {
  return {
    title: overrides.id,
    createdAt: NOW - DAY,
    updatedAt: NOW - 5 * MINUTE,
    cardCount: 0,
    shotCount: 0,
    durationSeconds: 0,
    ...overrides,
  };
}

function renderLobby() {
  const onOpenProject = vi.fn();
  const onShowIntro = vi.fn();
  render(<Lobby onOpenProject={onOpenProject} onShowIntro={onShowIntro} />);
  return { onOpenProject, onShowIntro };
}

const cards = () =>
  within(screen.getByRole('list', { name: '项目' }))
    .getAllByRole('listitem')
    .map(item => within(item).getByRole('heading', { level: 3 }).textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  store.projects = [];
  store.deleted = [];
  store.listeners.clear();
  store.nextId = 1;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  URL.createObjectURL = vi.fn(() => 'blob:cover');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('project lobby', () => {
  it('lists projects in the order given, with status and update time', () => {
    store.projects = [
      project({ id: 'b', title: '雨夜', shotCount: 3, cardCount: 6, durationSeconds: 12 }),
      project({ id: 'a', title: '海边', cardCount: 4, updatedAt: NOW - 2 * DAY }),
      project({ id: 'c', title: '新想法', updatedAt: NOW - 3 * 3_600_000 }),
    ];
    renderLobby();
    expect(cards()).toEqual(['雨夜', '海边', '新想法']);
    expect(screen.getByText('成片 3 个镜头 · 00:12')).toBeTruthy();
    expect(screen.getByText('4 个素材')).toBeTruthy();
    expect(screen.getByText('空白', { selector: '.fo-lobby-status' })).toBeTruthy();
    expect(screen.getByText('5 分钟前更新')).toBeTruthy();
    expect(screen.getByText('2 天前更新')).toBeTruthy();
    expect(screen.getByText('3 小时前更新')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('下午好。');
    expect(screen.getByText(/3 个项目，最近在做「雨夜」/)).toBeTruthy();
    expect(projects.purgeDeletedProjects).toHaveBeenCalled();
  });

  it('shows an empty state that creates and opens a project', async () => {
    const user = userEvent.setup();
    const { onOpenProject } = renderLobby();
    const empty = screen.getByRole('region', { name: '还没有项目' });
    await user.click(within(empty).getByRole('button', { name: '新建项目' }));
    expect(projects.createProject).toHaveBeenCalledWith(undefined);
    expect(onOpenProject).toHaveBeenCalledWith('new-1');
  });

  it('starts from an example in a new project', async () => {
    const user = userEvent.setup();
    const { onOpenProject } = renderLobby();
    await user.click(screen.getByRole('button', { name: '潮汐之后' }));
    expect(projects.createProject).toHaveBeenCalledWith('潮汐之后');
    expect(onOpenProject).toHaveBeenCalledWith('new-1');
    expect(takeExampleRequest()?.id).toBe('ocean');
  });

  it('creates a project from the header and opens a card when clicked', async () => {
    store.projects = [project({ id: 'a', title: '海边' })];
    const user = userEvent.setup();
    const { onOpenProject, onShowIntro } = renderLobby();
    await user.click(screen.getByRole('button', { name: '海边' }));
    expect(onOpenProject).toHaveBeenLastCalledWith('a');
    await user.click(screen.getByRole('button', { name: '新建项目' }));
    expect(onOpenProject).toHaveBeenLastCalledWith('new-1');
    await user.click(screen.getByRole('button', { name: '产品介绍' }));
    expect(onShowIntro).toHaveBeenCalled();
  });

  it('filters by title and by status', async () => {
    store.projects = [
      project({ id: 'a', title: '雨夜街头', shotCount: 2, cardCount: 2 }),
      project({ id: 'b', title: '海边' }),
      project({ id: 'c', title: '雨中的猫', cardCount: 1 }),
    ];
    const user = userEvent.setup();
    renderLobby();
    await user.type(screen.getByRole('searchbox', { name: '搜索项目' }), '雨');
    expect(cards()).toEqual(['雨夜街头', '雨中的猫']);
    await user.click(screen.getByRole('button', { name: /有成片/ }));
    expect(cards()).toEqual(['雨夜街头']);
    await user.type(screen.getByRole('searchbox'), '猫');
    expect(screen.getByRole('status').textContent).toContain('没有名字包含「雨猫」的项目');
    await user.click(screen.getByRole('button', { name: '显示全部项目' }));
    expect(cards()).toEqual(['雨夜街头', '海边', '雨中的猫']);
  });

  it('focuses search with ⌘K or Ctrl+K', () => {
    store.projects = [project({ id: 'a' })];
    renderLobby();
    const search = screen.getByRole('searchbox', { name: '搜索项目' });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(document.activeElement).toBe(search);
    search.blur();
    fireEvent.keyDown(window, { key: 'K', ctrlKey: true });
    expect(document.activeElement).toBe(search);
  });

  it('renames a project from the card menu', async () => {
    store.projects = [project({ id: 'a', title: '海边' })];
    const user = userEvent.setup();
    renderLobby();
    await user.click(screen.getByRole('button', { name: '「海边」更多操作' }));
    const menu = screen.getByRole('menu', { name: '「海边」操作' });
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: '重命名' }));
    await user.click(within(menu).getByRole('menuitem', { name: '重命名' }));
    const dialog = screen.getByRole('dialog', { name: '重命名项目' });
    const input = within(dialog).getByRole('textbox', { name: '项目名称' });
    await user.clear(input);
    expect(within(dialog).getByRole('button', { name: '保存' })).toHaveProperty('disabled', true);
    await user.type(input, '海边日落');
    await user.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(projects.renameProject).toHaveBeenCalledWith('a', '海边日落');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cards()).toEqual(['海边日落']);
  });

  it('closes the card menu with Escape', async () => {
    store.projects = [project({ id: 'a', title: '海边' })];
    const user = userEvent.setup();
    renderLobby();
    const trigger = screen.getByRole('button', { name: '「海边」更多操作' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('moves a deleted project to the trash and restores it', async () => {
    store.projects = [project({ id: 'a', title: '海边' }), project({ id: 'b', title: '雨夜' })];
    store.deleted = [project({ id: 'old', title: '旧片子', deletedAt: NOW - 28 * DAY })];
    const user = userEvent.setup();
    renderLobby();
    await user.click(screen.getByRole('button', { name: '「海边」更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '删除' }));
    const confirm = screen.getByRole('dialog', { name: '删除「海边」？' });
    expect(confirm.textContent).toContain('会移入已删除项目，保留 30 天，可以恢复');
    await user.click(within(confirm).getByRole('button', { name: '删除' }));
    expect(projects.deleteProject).toHaveBeenCalledWith('a');
    expect(cards()).toEqual(['雨夜']);

    await user.click(screen.getByRole('button', { name: '已删除项目（2 个）' }));
    const trash = screen.getByRole('dialog', { name: '已删除项目' });
    const rows = within(trash).getAllByRole('listitem');
    expect(rows[0].textContent).toContain('海边');
    expect(rows[0].textContent).toContain('还剩 30 天');
    expect(rows[1].textContent).toContain('还剩 2 天');
    await user.click(within(trash).getByRole('button', { name: '恢复「海边」' }));
    expect(projects.restoreDeletedProject).toHaveBeenCalledWith('a');
    expect(within(trash).getAllByRole('listitem')).toHaveLength(1);
    expect(cards()).toEqual(['海边', '雨夜']);
  });

  it('closes a dialog on Escape (cancel)', async () => {
    store.projects = [project({ id: 'a', title: '海边' })];
    const user = userEvent.setup();
    renderLobby();
    await user.click(screen.getByRole('button', { name: '已删除项目' }));
    const trash = screen.getByRole('dialog', { name: '已删除项目' });
    expect(trash.textContent).toContain('没有已删除的项目');
    fireEvent(trash, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a media-store cover and revokes its URL on unmount', async () => {
    store.projects = [
      project({ id: 'a', title: '海边', coverMediaId: 'media-cover', cardCount: 1 }),
      project({ id: 'b', title: '雨夜', coverSrc: '/assets/still-city.webp', cardCount: 1 }),
      project({ id: 'c', title: '空的' }),
    ];
    const { container } = render(<Lobby onOpenProject={vi.fn()} onShowIntro={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('img[src="blob:cover"]')).toBeTruthy());
    expect(getMedia).toHaveBeenCalledWith('media-cover');
    expect(container.querySelector('img[src="/assets/still-city.webp"]')).toBeTruthy();
    const blank = container.querySelectorAll('.fo-lobby-cover.is-blank');
    expect(blank).toHaveLength(1);
    expect(blank[0].textContent).toBe('空的');
    act(() => cleanup());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover');
  });

  it('picks up changes from the store', () => {
    renderLobby();
    act(() => {
      store.projects = [project({ id: 'x', title: '别处新建的' })];
      notify();
    });
    expect(cards()).toEqual(['别处新建的']);
  });
});
