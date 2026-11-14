import type { ReactNode } from 'react';
import { isDesktop } from '../../platform';
import Icon from '../../ui/Icon';

type CanvasTool = 'select' | 'hand';
export type PanelTab = 'workflow' | 'versions';

interface ToolButtonProps {
  icon: string;
  label: string;
  title?: string;
  /** Toggle buttons show their state as pressed; panel buttons as expanded. */
  pressed?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ToolButton({ icon, label, title, pressed, expanded, disabled, onClick }: ToolButtonProps) {
  const active = pressed ?? expanded ?? false;
  return (
    <button
      type="button"
      className={`fo-icon-button${active ? ' is-active' : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

const Divider = () => <span className="fo-tool-divider" />;

interface CanvasToolsProps {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  onUpload: () => void;
  onAddNote: (kind: 'text' | 'script') => void;
  onTidy: () => void;
  /** Desktop only: the header has no view tabs there. */
  listView: boolean;
  onToggleList: () => void;
  assetsOpen: boolean;
  onToggleAssets: () => void;
  panelTab: PanelTab | null;
  onPanel: (tab: PanelTab) => void;
  canUndo: boolean;
  canRedo: boolean;
  /** While a generation runs, history is locked. */
  busy: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onHelp: () => void;
}

export default function CanvasTools(props: CanvasToolsProps) {
  const { tool, onTool, panelTab, onPanel, busy } = props;
  // The browser opens the asset library, plans and versions from the header instead.
  let desktopPanels: ReactNode = null;
  if (isDesktop()) {
    desktopPanels = (
      <>
        <ToolButton
          icon="list"
          label="列表视图"
          title="列表视图：按脚本和镜头查看"
          pressed={props.listView}
          onClick={props.onToggleList}
        />
        <ToolButton
          icon="grid"
          label="项目素材"
          title="项目素材"
          expanded={props.assetsOpen}
          onClick={props.onToggleAssets}
        />
        <ToolButton
          icon="film"
          label="镜头计划"
          title="镜头计划"
          expanded={panelTab === 'workflow'}
          onClick={() => onPanel('workflow')}
        />
        <ToolButton
          icon="clock"
          label="版本记录"
          title="版本记录"
          expanded={panelTab === 'versions'}
          onClick={() => onPanel('versions')}
        />
        <Divider />
      </>
    );
  }
  return (
    <aside className="fo-canvas-tools" aria-label="画布工具">
      <ToolButton
        icon="cursor"
        label="选择工具"
        title="选择素材 · V"
        pressed={tool === 'select'}
        onClick={() => onTool('select')}
      />
      <ToolButton
        icon="hand"
        label="移动画布工具"
        title="移动画布 · H / 空格"
        pressed={tool === 'hand'}
        onClick={() => onTool('hand')}
      />
      <Divider />
      <ToolButton
        icon="upload"
        label="添加本地素材"
        title="添加本地图片或视频"
        onClick={props.onUpload}
      />
      <ToolButton
        icon="text"
        label="添加文本"
        title="添加文本：剧本、文案、备忘"
        onClick={() => props.onAddNote('text')}
      />
      <ToolButton
        icon="list"
        label="添加脚本"
        title="添加脚本：每行一个镜头，可整组生成"
        onClick={() => props.onAddNote('script')}
      />
      <ToolButton
        icon="tidy"
        label="整理画布"
        title="整理画布：脚本和它的结果排在一起 · ⌥ ⇧ F"
        onClick={props.onTidy}
      />
      {desktopPanels}
      <ToolButton
        icon="undo"
        label="撤销"
        title="撤销 · ⌘ / Ctrl Z"
        disabled={!props.canUndo || busy}
        onClick={props.onUndo}
      />
      <ToolButton
        icon="redo"
        label="重做"
        title="重做 · ⇧ ⌘ Z"
        disabled={!props.canRedo || busy}
        onClick={props.onRedo}
      />
      <Divider />
      <ToolButton icon="help" label="打开使用指南" onClick={props.onHelp} />
    </aside>
  );
}
