import type { RefObject } from 'react';
import type { Card, GenerationMode } from '../../types';
import type { useGeneration } from './useGeneration';
import { isDesktop } from '../../platform';
import ComposerParameters from './ComposerParameters';
import { ConsistencyBar } from './ConsistencyDialog';
import DesktopGenerationSettings from './DesktopGenerationSettings';
import Icon from '../../ui/Icon';
import Select from '../../ui/Select';

const MODE_OPTIONS = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
];

interface ComposerProps {
  generation: ReturnType<typeof useGeneration>;
  /** A generation or a shot plan is running. */
  busy: boolean;
  onStop: () => void;
  notes: string;
  references: Card[];
  /** Status of the selected card's video job or temporary link; empty when none. */
  taskNote: string;
  onConsistency: () => void;
  onSettings: () => void;
  formRef: RefObject<HTMLFormElement | null>;
  promptRef: RefObject<HTMLTextAreaElement | null>;
}

export default function Composer({
  generation,
  busy,
  onStop,
  notes,
  references,
  taskNote,
  onConsistency,
  onSettings,
  formRef,
  promptRef,
}: ComposerProps) {
  const desktop = isDesktop();
  const { config, mode } = generation;
  const model = mode === 'video' ? config.videoModel : config.imageModel;
  return (
    <form
      ref={formRef}
      className={`fo-composer${busy ? ' is-busy' : ''}`}
      onSubmit={event => {
        event.preventDefault();
        if (!busy) void generation.generate();
      }}
    >
      <div className="fo-composer-top">
        <label htmlFor="fo-prompt">{desktop ? '提示词' : '让想法，先有一个画面。'}</label>
        {!desktop && (
          <ComposerParameters
            config={config}
            video={mode === 'video'}
            disabled={busy}
            onChange={generation.setConfig}
            onSettings={onSettings}
          />
        )}
        <Select
          className="fo-generation-mode"
          value={mode}
          onChange={value => generation.setMode(value as GenerationMode)}
          options={MODE_OPTIONS}
          label="生成模式"
          disabled={busy}
        />
      </div>
      <ConsistencyBar notes={notes} references={references} onOpen={onConsistency} />
      <textarea
        ref={promptRef}
        className="fo-prompt"
        id="fo-prompt"
        rows={2}
        placeholder="描述你想生成的画面或镜头…"
        maxLength={4000}
        value={generation.prompt}
        onChange={event => generation.setPrompt(event.target.value)}
        onKeyDown={event => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void generation.generate();
          }
        }}
      />
      {desktop && (
        <DesktopGenerationSettings
          config={config}
          video={mode === 'video'}
          disabled={busy}
          onChange={generation.setConfig}
          onSettings={onSettings}
        />
      )}
      {taskNote && (
        <p className="fo-task-note" role="status">
          {taskNote}
        </p>
      )}
      <div className="fo-composer-bottom">
        {!busy && !config.key ? (
          <button type="button" className="fo-connect-service" onClick={onSettings}>
            连接生成服务
            <Icon name="arrow-up-right" />
          </button>
        ) : (
          <span className="fo-generation-state">
            {busy ? '正在等待供应商结果…' : `${config.provider.toUpperCase()} · ${model}`}
          </span>
        )}
        {busy && (
          <button type="button" className="fo-cancel-generation" onClick={onStop}>
            停止等待
          </button>
        )}
        <button type="submit" className="fo-generate-button" disabled={busy}>
          <Icon name="sparkles" />
          <span>{mode === 'video' ? '生成视频' : '生成图片'}</span>
          <Icon name="arrow-up-right" />
        </button>
      </div>
      <div className="fo-generation-line" />
    </form>
  );
}
