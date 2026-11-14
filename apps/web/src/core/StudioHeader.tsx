import { isDesktop } from '../platform';
import Icon from '../ui/Icon';
import ProjectTitle from './project/ProjectTitle';
import ThemeToggle from '../shell/misc/ThemeToggle';

interface StudioHeaderProps {
  title: string;
  /** Renames the project; without it the name is plain text. */
  onRename?: (title: string) => void;
  saveStatus: string;
  /** Whether the sequence has shots to preview or export. */
  hasShots: boolean;
  workflowOpen: boolean;
  /** The canvas, or the same project as a plain list of shots. */
  view?: StudioView;
  onView?: (view: StudioView) => void;
  /** Back to the project list. */
  onHome: () => void;
  onHelp: () => void;
  onToggleWorkflow: () => void;
  onSettings: () => void;
  onExportProject: () => void;
  onExportVideo: () => void;
  onPreview: () => void;
}

export type StudioView = 'canvas' | 'list';

/** The project file is not a backup: say so before people rely on it. */
const EXPORT_PROJECT_NOTE = '只含画布布局和设置，不含图片和视频，目前也还不能导回来。';

export default function StudioHeader({
  title,
  onRename,
  saveStatus,
  hasShots,
  workflowOpen,
  view = 'canvas',
  onView,
  onHome,
  onHelp,
  onToggleWorkflow,
  onSettings,
  onExportProject,
  onExportVideo,
  onPreview,
}: StudioHeaderProps) {
  // The desktop app keeps the tool actions in its side rail.
  const desktop = isDesktop();
  return (
    <header className="fo-header">
      <div className="fo-brand-slot">
        <button
          type="button"
          className="fo-back-projects"
          aria-label="返回项目列表"
          title="返回项目列表"
          onClick={onHome}
        >
          <Icon name="arrow-left" />
          <span>项目</span>
        </button>
      </div>
      <div className="fo-project">
        <span className="fo-project-divider">/</span>
        <div>
          <ProjectTitle title={title} onRename={onRename} />
          <span className="fo-save">
            <i />
            <span className="fo-save-label">{saveStatus}</span>
          </span>
        </div>
      </div>
      {!desktop && (
        <nav className="fo-workspace-tabs" aria-label="工作区">
          {(['canvas', 'list'] as const).map(item => (
            <button
              key={item}
              type="button"
              className={view === item ? 'is-active' : undefined}
              aria-current={view === item ? 'page' : undefined}
              onClick={() => onView?.(item)}
            >
              {item === 'canvas' ? '画布' : '列表'}
            </button>
          ))}
          <button type="button" onClick={onHelp}>
            使用指南 <Icon name="arrow-up-right" />
          </button>
        </nav>
      )}
      <div className="fo-header-actions">
        <ThemeToggle />
        {!desktop && (
          <>
            <button
              type="button"
              className="fo-text-button fo-flow-button"
              aria-expanded={workflowOpen}
              onClick={onToggleWorkflow}
            >
              镜头计划
            </button>
            <button
              type="button"
              className="fo-text-button fo-api-button"
              aria-label="API 设置"
              onClick={onSettings}
            >
              <Icon name="settings" />
              <span>API 设置</span>
            </button>
          </>
        )}
        <button
          type="button"
          className="fo-text-button fo-export-button"
          aria-label="导出项目文件"
          aria-describedby="fo-export-project-note"
          title={EXPORT_PROJECT_NOTE}
          onClick={onExportProject}
        >
          <Icon name="download" />
          <span>导出项目文件</span>
          <span id="fo-export-project-note" hidden>
            {EXPORT_PROJECT_NOTE}
          </span>
        </button>
        <button
          type="button"
          className="fo-text-button fo-export-video-button"
          aria-label="导出成片"
          disabled={!hasShots}
          onClick={onExportVideo}
        >
          <Icon name="film" />
          <span>导出成片</span>
        </button>
        <button
          type="button"
          className="fo-primary-button"
          disabled={!hasShots}
          onClick={onPreview}
        >
          <Icon name="play" />
          <span>预览成片</span>
        </button>
      </div>
    </header>
  );
}
