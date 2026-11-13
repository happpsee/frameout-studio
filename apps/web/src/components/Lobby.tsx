import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STUDIO_EXAMPLES, type StudioExample, requestExample } from '../lib/examples';
import {
  type ProjectSummary,
  createProject,
  deleteProject,
  listDeletedProjects,
  listProjects,
  purgeDeletedProjects,
  renameProject,
  restoreDeletedProject,
  subscribeProjects,
} from '../lib/projects';
import Icon from './Icon';
import { DeleteDialog, RenameDialog, TrashDialog } from './lobby/LobbyDialogs';
import LobbyHeader from './lobby/LobbyHeader';
import ProjectCard from './lobby/ProjectCard';
import { type ProjectStage, greeting, projectStage, timeAgo } from './lobby/format';
import '../styles/lobby.css';

interface LobbyProps {
  onOpenProject: (id: string) => void;
  onShowIntro: () => void;
}

type Filter = 'all' | ProjectStage;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'film', label: '有成片' },
  { id: 'material', label: '只有素材' },
  { id: 'blank', label: '空白' },
];

type Pending = { kind: 'rename' | 'delete'; project: ProjectSummary } | { kind: 'trash' };

/** Lists stay in sync with the store; removed projects are purged once on entry. */
function useProjectLists() {
  const [projects, setProjects] = useState<ProjectSummary[]>(listProjects);
  const [deleted, setDeleted] = useState<ProjectSummary[]>(listDeletedProjects);
  const refresh = useCallback(() => {
    setProjects(listProjects());
    setDeleted(listDeletedProjects());
  }, []);
  useEffect(() => {
    purgeDeletedProjects();
    refresh();
    return subscribeProjects(refresh);
  }, [refresh]);
  return { projects, deleted, refresh };
}

/** The current time, refreshed every minute so "x 分钟前" stays true. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function summaryLine(projects: readonly ProjectSummary[], now: number): string {
  if (!projects.length) return '还没有项目。新建一个，把想法放上画布。';
  const latest = projects.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
  return `${projects.length} 个项目，最近在做「${latest.title}」，${timeAgo(latest.updatedAt, now)}更新。`;
}

interface EmptyStateProps {
  onCreate: () => void;
  onExample: (example: StudioExample) => void;
}

function EmptyState({ onCreate, onExample }: EmptyStateProps) {
  return (
    <section className="fo-lobby-empty" aria-labelledby="fo-lobby-empty-heading">
      <Icon name="film" />
      <h2 id="fo-lobby-empty-heading">还没有项目</h2>
      <p>一个项目就是一块画布：放参考图、生成镜头，再排成片。</p>
      <button type="button" className="fo-primary-button" onClick={onCreate}>
        <Icon name="plus" />
        新建项目
      </button>
      <div className="fo-lobby-examples">
        <span>或者从示例开始：</span>
        {STUDIO_EXAMPLES.map(example => (
          <button
            key={example.id}
            type="button"
            className="fo-lobby-link"
            onClick={() => onExample(example)}
          >
            {example.name}
          </button>
        ))}
      </div>
    </section>
  );
}

export default function Lobby({ onOpenProject, onShowIntro }: LobbyProps) {
  const { projects, deleted, refresh } = useProjectLists();
  const now = useNow();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [pending, setPending] = useState<Pending | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: projects.length, film: 0, material: 0, blank: 0 };
    for (const project of projects) result[projectStage(project)]++;
    return result;
  }, [projects]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = projects.filter(
    project =>
      (filter === 'all' || projectStage(project) === filter) &&
      (!needle || project.title.toLocaleLowerCase().includes(needle)),
  );

  const create = (title?: string) => onOpenProject(createProject(title).id);
  const startExample = (example: StudioExample) => {
    requestExample(example.id);
    create(example.name);
  };
  const closeDialog = () => setPending(null);

  return (
    <div className="fo-studio fo-lobby">
      <LobbyHeader
        query={query}
        onQueryChange={setQuery}
        searchRef={searchRef}
        deletedCount={deleted.length}
        onShowIntro={onShowIntro}
        onShowTrash={() => setPending({ kind: 'trash' })}
        onCreate={() => create()}
      />
      <main className="fo-lobby-main">
        <section className="fo-lobby-greeting">
          <h1>{greeting(new Date(now).getHours())}。</h1>
          <p>{summaryLine(projects, now)}</p>
        </section>
        {projects.length ? (
          <>
            <div className="fo-lobby-toolbar">
              <div className="fo-lobby-filters" role="group" aria-label="按状态筛选">
                {FILTERS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                    <span>{counts[id]}</span>
                  </button>
                ))}
              </div>
              <span className="fo-lobby-sort">按最近更新排序</span>
            </div>
            {visible.length ? (
              <ul className="fo-lobby-grid" aria-label="项目">
                {visible.map(project => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    now={now}
                    onOpen={() => onOpenProject(project.id)}
                    onRename={() => setPending({ kind: 'rename', project })}
                    onDelete={() => setPending({ kind: 'delete', project })}
                  />
                ))}
              </ul>
            ) : (
              <div className="fo-lobby-no-match" role="status">
                <p>{needle ? `没有名字包含「${query.trim()}」的项目。` : '这一类还没有项目。'}</p>
                <button
                  type="button"
                  className="fo-lobby-link"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                >
                  显示全部项目
                </button>
              </div>
            )}
          </>
        ) : (
          <EmptyState onCreate={() => create()} onExample={startExample} />
        )}
      </main>
      {pending?.kind === 'rename' && (
        <RenameDialog
          project={pending.project}
          onRename={title => {
            renameProject(pending.project.id, title);
            refresh();
          }}
          onClose={closeDialog}
        />
      )}
      {pending?.kind === 'delete' && (
        <DeleteDialog
          project={pending.project}
          onDelete={() => {
            deleteProject(pending.project.id);
            refresh();
          }}
          onClose={closeDialog}
        />
      )}
      {pending?.kind === 'trash' && (
        <TrashDialog
          projects={deleted}
          now={now}
          onRestore={id => {
            restoreDeletedProject(id);
            refresh();
          }}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
