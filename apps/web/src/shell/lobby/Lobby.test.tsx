import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectSummary } from '../../core/project/projects';

const NOW = new Date(2026, 10, 13, 15, 0).getTime();
const MINUTE = 60_000;
const DAY = 86_400_000;

const store = vi.hoisted(() => ({
  projects: [] as ProjectSummary[],
  deleted: [] as ProjectSummary[],
  listeners: new Set<() => void>(),
  nextId: 1,
}));

vi.mock('../../core/project/projects', () => ({
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

vi.mock('../../core/project/media-store', () => ({
  getMedia: vi.fn(async (id: string) =>
    id === 'media-cover' ? new Blob(['x'], { type: 'image/png' }) : null,
  ),
}));

import * as projects from '../../core/project/projects';
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
  it('shows an empty state that creates and opens a project', async () => {
    const user = userEvent.setup();
    const { onOpenProject } = renderLobby();
    const empty = screen.getByRole('region', { name: '还没有项目' });
    await user.click(within(empty).getByRole('button', { name: '新建项目' }));
    expect(projects.createProject).toHaveBeenCalledWith(undefined);
    expect(onOpenProject).toHaveBeenCalledWith('new-1');
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

  it('renames a project from the card menu', async () => {
    store.projects = [project({ id: 'a', title: '海边' })];
    const user = userEvent.setup();
    renderLobby();
    await user.click(screen.getByRole('button', { name: '「海边」更多操作' }));
    // Radix names the menu after the button that opens it.
    const menu = screen.getByRole('menu', { name: '「海边」更多操作' });
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
});
