import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ExportAudio, ExportShot, ExportSize } from './export-video';
import { exportAudioSupported, exportSupported } from './export-support';
import {
  EXPORT_QUALITIES,
  EXPORT_RATIOS,
  exportFileName,
  loadExportPreferences,
  saveExportPreferences,
  type ExportQuality,
  type ExportRatio,
} from './export-preferences';
import Icon from '../../ui/Icon';
import Select from '../../ui/Select';
import { timeLabel } from './Sequence';
import './ExportDialog.css';

const SIZES: Record<ExportRatio, Record<ExportQuality, ExportSize>> = {
  '16:9': { '720p': { width: 1280, height: 720 }, '1080p': { width: 1920, height: 1080 } },
  '9:16': { '720p': { width: 720, height: 1280 }, '1080p': { width: 1080, height: 1920 } },
  '1:1': { '720p': { width: 720, height: 720 }, '1080p': { width: 1080, height: 1080 } },
};
type Phase =
  | { kind: 'idle'; message?: string }
  | { kind: 'running'; progress: number }
  | { kind: 'done'; url: string; bytes: number; fileName: string; sound: string }
  | { kind: 'error'; message: string };

const fileSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** What the finished message says about sound; empty when there is nothing to point out. */
export function soundNote(audio: ExportAudio, hasVideo: boolean): string {
  if (audio.kind === 'unsupported') return '这个浏览器不能处理声音，成片没有声音。';
  if (audio.kind === 'none') return hasVideo ? '视频片段都不带声音，成片没有声音。' : '';
  return audio.silent.length ? `${audio.silent.join('、')} 的声音读不出来，这几段没有声音。` : '';
}

export default function ExportDialog({
  shots,
  skipped,
  title,
  onClose,
}: {
  shots: ExportShot[];
  skipped: number;
  title: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const url = useRef('');
  const [{ ratio, quality }, setPreferences] = useState(loadExportPreferences);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const total = shots.reduce((sum, shot) => sum + shot.duration, 0);
  const running = phase.kind === 'running';
  const supported = exportSupported();
  const hasVideo = shots.some(shot => shot.card.kind === 'video');
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  useEffect(
    () => () => {
      controller.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  function choose(change: { ratio?: ExportRatio; quality?: ExportQuality }) {
    const next = { ratio, quality, ...change };
    setPreferences(next);
    saveExportPreferences(next);
  }
  function download(href: string, fileName: string) {
    const link = document.createElement('a');
    link.href = href;
    link.download = fileName;
    link.click();
  }
  async function start() {
    const current = new AbortController();
    controller.current = current;
    if (url.current) {
      URL.revokeObjectURL(url.current);
      url.current = '';
    }
    setPhase({ kind: 'running', progress: 0 });
    try {
      // Loaded on demand: the encoder library is large and only needed here.
      const { exportSequence } = await import('./export-video');
      const { blob, audio } = await exportSequence(shots, {
        ...SIZES[ratio][quality],
        signal: current.signal,
        onProgress: progress => setPhase({ kind: 'running', progress }),
      });
      if (current.signal.aborted) return;
      url.current = URL.createObjectURL(blob);
      const fileName = exportFileName(title);
      setPhase({
        kind: 'done',
        url: url.current,
        bytes: blob.size,
        fileName,
        sound: soundNote(audio, hasVideo),
      });
      download(url.current, fileName);
    } catch (error) {
      if (
        current.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        setPhase({ kind: 'idle', message: '已取消导出' });
        return;
      }
      setPhase({
        kind: 'error',
        message:
          error instanceof Error && error.name === 'ExportError'
            ? error.message
            : '导出失败，请换一个清晰度或稍后重试',
      });
    } finally {
      if (controller.current === current) controller.current = null;
    }
  }
  function close() {
    controller.current?.abort();
    onClose();
  }

  return (
    <dialog
      ref={dialog}
      className="fo-export-dialog"
      aria-labelledby="fo-export-heading"
      onCancel={event => {
        event.preventDefault();
        close();
      }}
      onClose={close}
    >
      <div className="fo-export-head">
        <div>
          <span className="fo-eyebrow">最后一步</span>
          <h2 id="fo-export-heading">导出成片</h2>
        </div>
        <button type="button" className="fo-icon-button" aria-label="关闭导出" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <p className="fo-export-summary">
        {shots.length} 个镜头 · {timeLabel(total)}
        {skipped > 0 && <span>另有 {skipped} 个镜头素材缺失或未完成，已跳过</span>}
      </p>
      <div className="fo-export-options">
        <label>
          画幅
          <Select
            label="导出画幅"
            value={ratio}
            onChange={value => choose({ ratio: value as ExportRatio })}
            options={EXPORT_RATIOS.map(value => ({ value, label: value }))}
            disabled={running}
          />
        </label>
        <label>
          清晰度
          <Select
            label="导出清晰度"
            value={quality}
            onChange={value => choose({ quality: value as ExportQuality })}
            options={EXPORT_QUALITIES.map(value => ({ value, label: value }))}
            disabled={running}
          />
        </label>
      </div>
      <p className="fo-export-note">
        按镜头顺序和时长渲染，画面与预览一致，MP4（H.264）每秒 30
        帧。会保留视频片段自带的声音；图片镜头没有声音；暂不支持配乐和字幕。在本机完成，不上传素材。
      </p>
      {running && (
        <div
          className="fo-export-progress"
          role="progressbar"
          aria-label="导出进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(phase.progress * 100)}
          style={{ '--progress': `${phase.progress * 100}%` } as CSSProperties}
        >
          <i />
          <span>正在导出 {Math.round(phase.progress * 100)}%</span>
        </div>
      )}
      {phase.kind === 'done' && (
        <p className="fo-export-status" role="status" data-state="success">
          已导出 {phase.fileName} · {fileSize(phase.bytes)}
          {phase.sound && <span className="fo-export-sound-note">{phase.sound}</span>}
        </p>
      )}
      {phase.kind === 'error' && (
        <p className="fo-export-status" role="alert" data-state="error">
          {phase.message}
        </p>
      )}
      {phase.kind === 'idle' && phase.message && (
        <p className="fo-export-status" role="status">
          {phase.message}
        </p>
      )}
      {supported && hasVideo && !exportAudioSupported() && (
        <p className="fo-export-status">这个浏览器不能处理声音，导出的成片会没有声音。</p>
      )}
      {!supported && (
        <p className="fo-export-status" role="alert" data-state="error">
          当前浏览器不支持视频编码，请使用最新版 Chrome、Edge 或桌面版。
        </p>
      )}
      <div className="fo-export-actions">
        {running ? (
          <button
            type="button"
            className="fo-text-button"
            onClick={() => controller.current?.abort()}
          >
            取消导出
          </button>
        ) : phase.kind === 'done' ? (
          <button
            type="button"
            className="fo-text-button"
            onClick={() => download(phase.url, phase.fileName)}
          >
            <Icon name="download" />
            <span>再次下载</span>
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="fo-primary-button"
          disabled={running || !supported || !shots.length}
          onClick={() => void start()}
        >
          {phase.kind === 'done' ? '重新导出' : '开始导出'}
          <Icon name="arrow-up-right" />
        </button>
      </div>
    </dialog>
  );
}
