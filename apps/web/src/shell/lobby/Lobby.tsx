import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STUDIO_EXAMPLES, type StudioExample, requestExample } from '../misc/examples';
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
} from '../../core/project/projects';
import { DeleteDialog, RenameDialog, TrashDialog } from './LobbyDialogs';
import LobbyHeader from './LobbyHeader';
import ProjectCard, { ExampleCard, NewProjectCard } from './ProjectCard';
import { type ProjectStage, projectStage } from './format';
import '../../styles/lobby.css';

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
      />
      <main className="fo-lobby-main">
        <div className="fo-lobby-toolbar">
          <h1>全部项目</h1>
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
          <span className="fo-lobby-sort">
            {projects.length ? '按最近更新排序' : '还没有项目：新建一个，或者打开示例试试'}
          </span>
        </div>
        {projects.length && !visible.length ? (
          <div className="fo-lobby-no-match" role="status">
            <p>{needle ? `没有名字包含「${query.trim()}」的项目。` : '这一类还没有项目。'}</p>
            <button
              type="button"
              className="fo-text-button"
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
            >
              显示全部项目
            </button>
          </div>
        ) : (
          <ul className="fo-lobby-grid" aria-label="项目">
            <NewProjectCard onCreate={() => create()} />
            {visible.map((project, index) => (
              <ProjectCard
                key={project.id}
                project={project}
                index={index + 1}
                now={now}
                onOpen={() => onOpenProject(project.id)}
                onRename={() => setPending({ kind: 'rename', project })}
                onDelete={() => setPending({ kind: 'delete', project })}
              />
            ))}
            {!projects.length &&
              STUDIO_EXAMPLES.map(example => (
                <ExampleCard
                  key={example.id}
                  example={example}
                  onOpen={() => startExample(example)}
                />
              ))}
          </ul>
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
