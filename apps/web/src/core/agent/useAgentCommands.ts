import { useEffect, useRef, type RefObject } from 'react';
import type { AIConfig, ProjectState } from '../../types';
import { STEP_X } from '../canvas/canvas-layout';
import { AgentCommandError, setAgentHandler } from './agent-bridge';
import { frameFile, viewCard } from './media-view';
import { projectSummary } from './project-summary';
import { cardStatus, generateImage, generateVideo, type GenerateDeps } from './generate-commands';

type Options = {
  /** Only the project in front takes commands. */
  active: boolean;
  projectRef: RefObject<ProjectState>;
  importFiles: (files: File[], point?: { x: number; y: number }) => Promise<string[]>;
  toast: (message: string) => void;
  /** The desktop task engine; null on the web. */
  engine: GenerateDeps['engine'];
  /** The settings the composer uses now, key included. */
  config: () => AIConfig;
};

const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * What an agent can do in the open project (step 1: read it, look at cards, bring media in).
 * Each command is answered with plain data the agent can use in its next call.
 */
export function useAgentCommands(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!options.active) return;
    const card = (id: unknown) => {
      const found = latest.current.projectRef.current.cards.find(item => item.id === id);
      if (!found)
        throw new AgentCommandError(
          'NO_CARD',
          `没有这张卡片：${String(id)}，先用 get_project 查 id`,
        );
      return found;
    };
    return setAgentHandler(async (name, args) => {
      const { projectRef, importFiles, toast, engine, config } = latest.current;
      const deps = () => ({ project: projectRef.current, engine, config: config(), toast });
      switch (name) {
        case 'generate_image':
          return generateImage(deps(), args);
        case 'generate_video':
          return generateVideo(deps(), args);
        case 'card_status':
          return cardStatus(projectRef.current, args.cardId);
        case 'get_project':
          return projectSummary(projectRef.current);
        case 'view_card':
          return viewCard(card(args.cardId));
        case 'import_media': {
          const response = await fetch(`/api/agent/bridge/files/${String(args.fileId)}`);
          if (!response.ok) throw new AgentCommandError('NO_FILE', '文件已过期，请重新导入');
          const blob = await response.blob();
          const file = new File([blob], String(args.name || '素材'), { type: blob.type });
          const x = number(args.x);
          const y = number(args.y);
          const ids = await importFiles(
            [file],
            x !== undefined && y !== undefined ? { x, y } : undefined,
          );
          if (!ids.length) throw new AgentCommandError('UNSUPPORTED_FILE', '只能导入图片或视频');
          toast(`Claude 导入了「${file.name}」`);
          return { cardId: ids[0] };
        }
        case 'extract_frame': {
          const source = card(args.cardId);
          const file = await frameFile(source, number(args.seconds) ?? 0);
          const [id] = await importFiles([file], { x: source.x + STEP_X, y: source.y });
          if (!id) throw new AgentCommandError('FAILED', '取帧失败');
          toast(`Claude 从「${source.name}」取了一帧`);
          return { cardId: id, name: file.name };
        }
        default:
          throw new AgentCommandError('UNKNOWN_COMMAND', `帧外还不支持「${name}」，请更新帧外`);
      }
    });
  }, [options.active]);
}
