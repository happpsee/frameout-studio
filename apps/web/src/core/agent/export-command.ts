import type { ProjectState } from '../../types';
import { pending } from '../canvas/CanvasCard';
import { soundNote } from '../film/ExportDialog';
import {
  EXPORT_QUALITIES,
  EXPORT_RATIOS,
  exportFileName,
  SIZES,
  type ExportQuality,
  type ExportRatio,
} from '../film/export-preferences';
import { randomId } from '../project/random-id';
import { AgentCommandError } from './agent-bridge';

type Run =
  | { status: 'running'; progress: number }
  | { status: 'done'; fileId: string; fileName: string; bytes: number; sound: string }
  | { status: 'failed'; error: string };

/** Exports started by an agent, by id. The file goes to the local server for the agent to fetch. */
const runs = new Map<string, Run>();

const usable = (project: ProjectState, id: string) => {
  const card = project.cards.find(item => item.id === id);
  return card && !card.missingMedia && !pending(card) ? card : undefined;
};

/** export_film: renders the film as the export dialog does, in the background. */
export function startExport(project: ProjectState, args: Record<string, unknown>) {
  const ratio = (args.ratio ?? '9:16') as ExportRatio;
  const quality = (args.quality ?? '1080p') as ExportQuality;
  if (!EXPORT_RATIOS.includes(ratio) || !EXPORT_QUALITIES.includes(quality))
    throw new AgentCommandError(
      'INVALID_ARGS',
      `画幅可选 ${EXPORT_RATIOS.join('、')}，清晰度可选 ${EXPORT_QUALITIES.join('、')}`,
    );
  const shots = project.sequence.flatMap(shot => {
    const card = usable(project, shot.cardId);
    return card ? [{ card, duration: shot.duration }] : [];
  });
  if (!shots.length) throw new AgentCommandError('EMPTY_FILM', '成片里还没有可导出的镜头');
  const sounds = (project.sounds ?? []).flatMap(clip => {
    const card = usable(project, clip.cardId);
    return card ? [{ clip, card }] : [];
  });
  const id = randomId();
  runs.set(id, { status: 'running', progress: 0 });
  void (async () => {
    try {
      // Loaded on demand, as the dialog does: the encoder library is large.
      const { exportSequence } = await import('../film/export-video');
      const { blob, audio } = await exportSequence(shots, {
        ...SIZES[ratio][quality],
        sounds,
        onProgress: progress => runs.set(id, { status: 'running', progress }),
      });
      const response = await fetch('/api/agent/bridge/files', {
        method: 'POST',
        headers: { 'content-type': 'video/mp4' },
        body: blob,
      });
      if (!response.ok) throw new Error('成片交给本机服务失败');
      const { fileId } = (await response.json()) as { fileId: string };
      runs.set(id, {
        status: 'done',
        fileId,
        fileName: exportFileName(project.title),
        bytes: blob.size,
        sound:
          soundNote(
            audio,
            shots.some(shot => shot.card.kind === 'video'),
          ) || '声音正常',
      });
    } catch (error) {
      runs.set(id, { status: 'failed', error: (error as Error).message });
    }
  })();
  return { exportId: id, shots: shots.length, skipped: project.sequence.length - shots.length };
}

/** export_status: progress, then where to fetch the file. */
export function exportStatus(id: unknown) {
  const run = runs.get(String(id));
  if (!run) throw new AgentCommandError('NO_EXPORT', '没有这次导出，可能帧外已经重开');
  if (run.status !== 'running') runs.delete(String(id));
  return run.status === 'running' ? { ...run, progress: Math.round(run.progress * 100) } : run;
}
