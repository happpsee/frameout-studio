import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from '../types';
import { useWorkspace } from './project/useWorkspace';
import { useGeneration } from './generation/useGeneration';
import { useEngineTasks } from './generation/useEngineTasks';
import { useCanvas } from './canvas/useCanvas';
import { useFileImport } from './canvas/useFileImport';
import { useAgentCommands } from './agent/useAgentCommands';
import { useCardActions } from './canvas/useCardActions';
import { useStudioShortcuts } from './canvas/useStudioShortcuts';
import { useSelectionLayout } from './canvas/useSelectionLayout';
import { useWorkflow } from './generation/useWorkflow';
import { useExampleImport } from '../shell/misc/useExampleImport';
import { useNotes } from './canvas/useNotes';
import { linkedIds } from './canvas/notes';
import { nextRole } from './generation/consistency';
import { thumbnails, wantsOriginal } from './canvas/thumbnails';
import { CanvasNote } from './canvas/CanvasNote';
import CardPrompt from './generation/CardPrompt';
import { formatYuan, projectCost, quote } from './generation/pricing';
import { mentionNames, resolveMentions } from './generation/mentions';
import { useOpenPrompts } from './generation/useOpenPrompts';
import { cardPrompt, type PromptAction } from './generation/card-prompt';
import { CARD_CENTER } from './canvas/canvas-camera';
import FlowStage from './canvas/FlowStage';
import { addText, linkedTexts, removeText, textDraft, withTexts } from './canvas/text-links';
import {
  addReference,
  draftCard,
  DRAFT_LABEL,
  removeReference,
  renameLink,
  reorderReferences,
  sentReferences,
} from './canvas/card-links';
import { readStoredValue } from './project/desktop-storage';
import { desktopBridge, isDesktop } from '../platform';
import { serializeProject } from './project/project';
import { projectDataKeys } from './project/projects';
import APISettings from '../shell/settings/APISettings';
import Icon from '../ui/Icon';
import { CanvasCard, jobNote, pending } from './canvas/CanvasCard';
import { regeneration } from './generation/regenerate';
import Sequence from './film/Sequence';
import { useFilm } from './film/useFilm';
import PreviewDialog from './film/PreviewDialog';
import FilmCard from './film/FilmCard';
import { addSound } from './film/sound-clips';
import { FILM_ID, removeShot } from './canvas/film-node';
import ExportDialog from './film/ExportDialog';
import ConsistencyDialog from './generation/ConsistencyDialog';
import { referenceCards } from './generation/consistency';
import WorkflowPanel from './generation/WorkflowPanel';
import AssetLibrary from './canvas/AssetLibrary';
import StudioHeader, { type StudioView } from './StudioHeader';
import ShotList from './canvas/ShotList';
import CanvasTools, { type PanelTab } from './canvas/CanvasTools';
import SelectionActions from './canvas/SelectionActions';
import MultiSelectionBar from './canvas/MultiSelectionBar';
import ZoomControl from './canvas/ZoomControl';
import Composer from './generation/Composer';
import HelpDialog from '../shell/misc/HelpDialog';
import BrowserStorageNotice from '../shell/misc/BrowserStorageNotice';

function needsInitialFit(projectId: string) {
  try {
    const saved = JSON.parse(readStoredValue(projectDataKeys(projectId).project) || 'null');
    return !(
      saved?.version === 1 &&
      Array.isArray(saved.cards) &&
      Array.isArray(saved.sequence) &&
      ['x', 'y', 'zoom'].every(key => Number.isFinite(saved.camera?.[key]))
    );
  } catch {
    return true;
  }
}

export default function Studio({
  projectId,
  onClose,
  onShowIntro = onClose,
  active: isActive = true,
}: {
  /** Mount with key={projectId}: undo history and generation state belong to one project. */
  projectId: string;
  /** Back to the project list. */
  onClose: () => void;
  onShowIntro?: () => void;
  active?: boolean;
}) {
  const desktop = isDesktop();
  const {
    project,
    projectRef,
    update,
    undo,
    redo,
    canUndo,
    canRedo,
    saveStatus,
    flush,
    renameProject,
    createCheckpoint,
    restoreCheckpoint,
  } = useWorkspace(projectId);
  // Elements
  const studioRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const selectionRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Dialogs and panels
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [consistencyOpen, setConsistencyOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab | null>(null);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [view, setView] = useState<StudioView>('canvas');
  const [toastText, setToastText] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Capture before effects: StrictMode cleanup may save a default camera before
  // the second effect setup. That save should not suppress the first fit.
  const [fitOnOpen] = useState(() => needsInitialFit(projectId));
  const didInitialFit = useRef(!fitOnOpen);

  const toast = useCallback((message: string) => {
    setToastText(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(''), 3300);
  }, []);
  const {
    timelineOpen,
    toggleTimeline,
    preview,
    closePreview,
    exporting,
    closeExport,
    addToSequence,
    openExport,
    openPreview,
    updateDuration,
  } = useFilm({ project, projectRef, update, toast });
  const getProject = useCallback(() => projectRef.current, [projectRef]);
  const openSettings = useCallback((notice = '') => {
    setSettingsNotice(notice);
    setSettingsOpen(true);
  }, []);
  const engineTasks = useEngineTasks({ projectId, update });
  const generation = useGeneration({
    getProject,
    update,
    toast,
    openSettings,
    engine: engineTasks,
  });
  const workflow = useWorkflow({
    project,
    projectRef,
    update,
    generation,
    flush,
    createCheckpoint,
    toast,
    openSettings,
    enabled: isActive,
  });
  const active = generation.active || workflow.running || workflow.settling;
  const { stop: stopGeneration } = generation;
  const { pause: pauseWorkflow } = workflow;
  const generationActive = useRef(active);
  generationActive.current = active;
  const { importFiles, pendingImports } = useFileImport({ projectRef, viewportRef, update, toast });
  useAgentCommands({ active: isActive, projectRef, importFiles, toast });
  useEffect(
    () =>
      desktopBridge()?.onBeforeClose(async () => {
        pauseWorkflow();
        stopGeneration();
        await Promise.all(pendingImports.current);
        await flush();
      }),
    [flush, stopGeneration, pauseWorkflow, pendingImports],
  );
  useEffect(() => {
    // Leaving for the project list: save now so the list shows the latest counts and cover.
    if (!isActive) flush().catch(() => {});
  }, [isActive, flush]);
  const canvas = useCanvas({
    active: isActive,
    viewportRef,
    projectRef,
    update,
    addToSequence,
    onFiles: importFiles,
    onBackgroundDoubleClick: () => promptRef.current?.focus(),
  });
  const { cancelGesture, fit: fitCanvas, zoomBy, setTool } = canvas;
  useExampleImport({
    active: isActive,
    projectRef,
    update,
    viewportRef,
    camera: canvas.camera,
    restoreCamera: canvas.restoreCamera,
    setPrompt: generation.setPrompt,
    toast,
  });
  const notes = useNotes({
    projectRef,
    update,
    viewportRef,
    workflow,
    clearCards: () => canvas.selection.select(null),
    toast,
  });
  const linked = linkedIds(project, project.selected, notes.selected);
  const original = wantsOriginal(canvas.camera.zoom, window.devicePixelRatio);
  useEffect(() => {
    // Off-screen cards too, so panning to them does not load their full files first.
    project.cards.forEach(thumbnails.request);
  }, [project.cards]);
  const selected = project.cards.find(card => card.id === project.selected);
  const prompts = useOpenPrompts(project.cards);
  const hasSelection = Boolean(selected);
  const selectedJobStatus = selected?.job?.status;
  const selectedPosition = selected;
  const { removeSelected, toggleReference, arrangeCards, tidyCanvas } = useCardActions({
    projectRef,
    update,
    toast,
    active,
    cancelGesture,
    fitCanvas,
    provider: generation.config.provider,
  });
  // Stable callbacks let memoized cards and the sequence skip renders; they call the latest handlers.
  const cardActions = useRef<{
    openPreview: (card?: Card) => void;
    updateDuration: (card: Card, duration: number) => void;
  }>(null!);
  const { show: showPrompt } = prompts;
  /** The user picked a card: select it and open its prompt box. */
  const selectCard = useCallback(
    (id: string) => {
      showPrompt(id);
      update(draft => {
        draft.selected = id;
      }, false);
    },
    [update, showPrompt],
  );
  const openCard = useCallback(
    (id: string) => {
      const card = projectRef.current.cards.find(c => c.id === id);
      if (card) cardActions.current.openPreview(card);
    },
    [projectRef],
  );
  const cardDuration = useCallback(
    (card: Card, duration: number) => cardActions.current.updateDuration(card, duration),
    [],
  );
  const previewShot = useCallback(
    (card: Card) => {
      update(draft => {
        draft.selected = card.id;
      }, false);
      cardActions.current.openPreview(card);
    },
    [update],
  );
  const guardedUndo = () => {
    canvas.cancelGesture();
    if (!active) undo();
  };
  const guardedRedo = () => {
    canvas.cancelGesture();
    if (!active) redo();
  };

  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (!isActive || didInitialFit.current) return;
    const frame = requestAnimationFrame(() => {
      fitCanvas(false);
      didInitialFit.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [isActive, fitCanvas]);
  useEffect(() => {
    if (isActive) return;
    if (generationActive.current) stopGeneration();
    cancelGesture();
    setSettingsOpen(false);
    setHelpOpen(false);
    setZoomOpen(false);
    closePreview();
    closeExport();
    setConsistencyOpen(false);
    if (
      document.activeElement instanceof HTMLElement &&
      studioRef.current?.contains(document.activeElement)
    )
      document.activeElement.blur();
  }, [isActive, stopGeneration, cancelGesture, closePreview, closeExport]);
  useStudioShortcuts({
    isActive,
    active,
    undo,
    redo,
    cancelGesture,
    fitCanvas,
    zoomBy,
    setTool,
    projectRef,
    removeSelected,
    update,
    tidyCanvas,
    setZoomOpen,
  });
  cardActions.current = { openPreview, updateDuration };
  function exportProject() {
    const exported = {
      ...serializeProject(projectRef.current),
      exportedAt: new Date().toISOString(),
    };
    const data = JSON.stringify(
      exported,
      (key, value) => (/^(?:key|apiKey|authorization)$/i.test(key) ? undefined : value),
      2,
    );
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.title || 'frameout'}-项目.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出项目文件：只含布局和设置，图片和视频请另外保存');
  }
  const { selectionStyle, outside } = useSelectionLayout({
    isActive,
    desktop,
    viewportRef,
    composerRef,
    selectionRef,
    camera: canvas.camera,
    selectedPosition,
    hasSelection,
    mode: generation.mode,
    selectedJobStatus,
  });
  /** Starts what a card's prompt box asked for. Draft cards are filled from their linked cards. */
  const runPrompt = (card: Card, action: PromptAction, typed: string) => {
    const sent = sentReferences(card, project).cards;
    // "@name" becomes "图N" in the order the images are sent, in typed and linked words alike.
    const prompt = resolveMentions(
      withTexts(typed, linkedTexts(card, project.notes)),
      mentionNames(sent, card),
    );
    const textIds = card.textIds;
    const draft = card.label === DRAFT_LABEL;
    if (action.kind === 'video' && draft) {
      const first = sent.find(item => item.kind === 'image' && !item.missingMedia);
      if (!first) return toast('先从一张图片拉线连到这里，它会作为视频的首帧');
      update(draft => {
        draft.cards = draft.cards.filter(item => item.id !== card.id);
      });
      void generation.generate(first, { prompt, mode: 'video', position: card });
    } else if (action.kind === 'video') void generation.generate(card, { prompt, mode: 'video' });
    else if (action.kind === 'redo')
      void generation.generate(action.source, { prompt, mode: 'video', near: card });
    else
      void generation.generate(undefined, {
        prompt,
        mode: 'image',
        near: card,
        replace: action.replace ? card.id : undefined,
        // Exactly what the box shows, in its order; a failed retry keeps the project's references.
        references: action.replace && !draft ? undefined : sent,
        textIds,
      });
  };
  const taskNote =
    selected?.job && pending(selected)
      ? jobNote(selected)
      : selected?.remoteTemporary
        ? '供应商素材链接可能过期，请及时下载保存。'
        : '';

  const openPanel = (tab: PanelTab) => {
    setAssetsOpen(false);
    setPanelTab(current => (current === tab ? null : tab));
  };
  const focusCard = (card: Card) => {
    canvas.cancelGesture();
    update(draft => {
      draft.selected = card.id;
    }, false);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect)
      canvas.restoreCamera({
        zoom: canvas.camera.zoom,
        x: rect.width / 2 - (card.x + CARD_CENTER.x) * canvas.camera.zoom,
        y: rect.height / 2 - (card.y + CARD_CENTER.y) * canvas.camera.zoom,
      });
  };
  const references = referenceCards(project);
  const referenceIds = new Set(references.map(card => card.id));
  const composer = (
    <Composer
      generation={generation}
      busy={active}
      notes={project.consistency?.notes ?? ''}
      references={references}
      taskNote={taskNote}
      onConsistency={() => setConsistencyOpen(true)}
      onSettings={() => openSettings()}
      formRef={composerRef}
      promptRef={promptRef}
    />
  );
  const canvasTools = (
    <CanvasTools
      tool={canvas.tool}
      onTool={canvas.setTool}
      onUpload={() => fileInput.current?.click()}
      onAddNote={notes.add}
      onTidy={tidyCanvas}
      listView={view === 'list'}
      onToggleList={() => setView(value => (value === 'list' ? 'canvas' : 'list'))}
      assetsOpen={assetsOpen}
      onToggleAssets={() => {
        setPanelTab(null);
        setAssetsOpen(value => !value);
      }}
      panelTab={panelTab}
      onPanel={openPanel}
      canUndo={canUndo}
      canRedo={canRedo}
      busy={active}
      onUndo={guardedUndo}
      onRedo={guardedRedo}
      onHelp={() => setHelpOpen(true)}
    />
  );
  const workflowPanel = isActive && panelTab && (
    <WorkflowPanel
      tab={panelTab}
      onTab={setPanelTab}
      onClose={() => setPanelTab(null)}
      project={project}
      workflow={workflow}
      busy={active}
      createCheckpoint={createCheckpoint}
      restoreCheckpoint={id => {
        canvas.cancelGesture();
        restoreCheckpoint(id);
        canvas.restoreCamera(projectRef.current.camera);
      }}
      toast={toast}
      selectCard={id =>
        update(draft => {
          draft.selected = id;
        }, false)
      }
      addToSequence={addToSequence}
    />
  );

  return (
    <div
      ref={studioRef}
      id="studio-root"
      className={`fo-studio${desktop ? ' is-desktop' : ''}`}
      hidden={!isActive}
    >
      <div className="fo-app">
        <StudioHeader
          title={project.title}
          onRename={renameProject}
          saveStatus={saveStatus}
          hasShots={project.sequence.length > 0}
          workflowOpen={panelTab !== null}
          view={view}
          onView={setView}
          onHome={() => {
            canvas.cancelGesture();
            onClose();
          }}
          onHelp={() => setHelpOpen(true)}
          onToggleWorkflow={() => setPanelTab(value => (value ? null : 'workflow'))}
          onSettings={() => openSettings()}
          onExportProject={exportProject}
          onExportVideo={openExport}
          onPreview={() => openPreview()}
        />
        <div className="fo-workspace-body">
          {desktop && (
            <nav className="fo-desktop-rail" aria-label="工作台工具">
              {canvasTools}
            </nav>
          )}
          {desktop && assetsOpen && (
            <AssetLibrary
              cards={project.cards}
              selected={project.selected}
              onSelect={focusCard}
              onUpload={() => fileInput.current?.click()}
              onClose={() => setAssetsOpen(false)}
            />
          )}
          {desktop && workflowPanel}
          <div className="fo-workspace-center">
            <main
              ref={viewportRef}
              className={`fo-viewport${canvas.tool === 'hand' || canvas.space ? ' is-hand' : ''}${canvas.panning ? ' is-panning' : ''}${canvas.fileDrop ? ' is-file-drop' : ''}${view === 'list' ? ' is-list' : ''}`}
              aria-label="无限创作画布"
              style={{
                backgroundSize: `${26 * canvas.camera.zoom}px ${26 * canvas.camera.zoom}px`,
                backgroundPosition: `${canvas.camera.x}px ${canvas.camera.y}px`,
              }}
            >
              <div className="fo-canvas-intro">
                <span className="fo-eyebrow">画布</span>
                <span className="fo-canvas-count">{project.cards.length} 个素材</span>
                <span className="fo-canvas-count" title="按火山方舟价目表估算，以控制台账单为准">
                  生成花费约 {formatYuan(projectCost(project.cards))}
                </span>
                <BrowserStorageNotice />
              </div>
              {view === 'list' && (
                <ShotList
                  project={project}
                  onPreview={previewShot}
                  onAddShot={addToSequence}
                  onLocate={({ card, noteId }) => {
                    setView('canvas');
                    if (card) focusCard(card);
                    else if (noteId) notes.select(noteId);
                  }}
                />
              )}
              <FlowStage
                canvas={canvas}
                cards={project.cards}
                notes={project.notes ?? []}
                sequence={project.sequence}
                film={project.film}
                selected={project.selected}
                consistency={project.consistency}
                raised={prompts.open}
                onLink={(from, to) => {
                  if (to === FILM_ID) {
                    if (from.startsWith('note:')) toast('文本不能加入成片，请连视频或图片');
                    else addToSequence(from);
                    return;
                  }
                  const note = from.startsWith('note:') ? from.slice(5) : null;
                  let linked = false;
                  update(draft => {
                    linked = note ? addText(draft, note, to) : addReference(draft, from, to);
                  });
                  if (!linked) toast('这条线已经有了，或者会连成一个圈');
                }}
                onUnlink={id =>
                  update(draft => {
                    if (removeShot(draft, id)) return;
                    removeReference(draft, id);
                    removeText(draft, id);
                  })
                }
                onDraft={(from, at) => {
                  const card = from.startsWith('note:')
                    ? textDraft(from.slice(5), at)
                    : draftCard(from, at);
                  update(draft => {
                    draft.cards.push(card);
                    draft.selected = card.id;
                  });
                  prompts.show(card.id);
                }}
                onRename={(link, name) => update(draft => renameLink(draft, link, name))}
                render={{
                  film: () => (
                    <FilmCard
                      sequence={project.sequence}
                      cards={project.cards}
                      onPreview={() => openPreview()}
                    />
                  ),
                  card: card => {
                    const plan = prompts.open.has(card.id) && cardPrompt(card, project.cards);
                    return (
                      <>
                        <CanvasCard
                          card={card}
                          selected={
                            selected?.id === card.id || canvas.selection.ids.includes(card.id)
                          }
                          dragging={false}
                          reference={referenceIds.has(card.id)}
                          linked={linked.cards.has(card.id)}
                          original={original}
                          onSelect={selectCard}
                          onOpen={openCard}
                          onDuration={cardDuration}
                        />
                        {plan && (
                          <CardPrompt
                            key={card.id}
                            card={card}
                            plan={plan}
                            busy={active}
                            onRun={(action, text) => runPrompt(card, action, text)}
                            onClose={() => prompts.close(card.id)}
                            toast={toast}
                            references={sentReferences(card, project)}
                            texts={linkedTexts(card, project.notes)}
                            prices={{
                              image: quote(
                                generation.config,
                                'image',
                                sentReferences(card, project).cards.length,
                              ),
                              video: quote(generation.config, 'video'),
                            }}
                            onReorder={ids =>
                              update(draft => reorderReferences(draft, card.id, ids))
                            }
                            onUnlink={id =>
                              update(draft => removeReference(draft, `${id}>${card.id}:reference`))
                            }
                          />
                        )}
                      </>
                    );
                  },
                  note: note => (
                    <CanvasNote
                      note={note}
                      zoom={canvas.camera.zoom}
                      selected={notes.selected === note.id}
                      linked={linked.notes.has(note.id)}
                      workflow={project.workflow}
                      busy={active}
                      results={project.cards.filter(card => card.noteId === note.id).length}
                      onSelect={notes.select}
                      onChange={notes.change}
                      onMove={notes.move}
                      onRemove={notes.remove}
                      onUsePrompt={text => {
                        generation.setPrompt(text);
                        promptRef.current?.focus();
                        toast('已填入生成框');
                      }}
                      onPlan={notes.plan}
                      onStart={() => void workflow.start()}
                      onPause={workflow.pause}
                      onSelectCard={selectCard}
                    />
                  ),
                }}
              />
              {!project.cards.length && !project.notes?.length && (
                <div className="fo-canvas-empty">
                  {desktop ? (
                    <>
                      <div className="fo-empty-symbol">
                        <Icon name="grid" />
                      </div>
                      <h2>从第一个画面开始</h2>
                    </>
                  ) : (
                    <span>从第一个画面开始。</span>
                  )}
                  <p>上传图片或视频，输入提示词生成素材，或者先写一份脚本。</p>
                  <button
                    type="button"
                    className="fo-primary-button"
                    onClick={() => fileInput.current?.click()}
                  >
                    添加素材 <Icon name="plus" />
                  </button>
                  <button
                    type="button"
                    className="fo-inline-button"
                    onClick={() => notes.add('script')}
                  >
                    先写脚本
                  </button>
                </div>
              )}

              {!desktop && canvasTools}
              {selected && (
                <SelectionActions
                  card={selected}
                  outside={outside}
                  style={selectionStyle}
                  barRef={selectionRef}
                  busy={active}
                  isReference={referenceIds.has(selected.id)}
                  regeneration={regeneration(selected, project.cards)}
                  onGenerateVideo={() => {
                    // With nothing in the main prompt box, the words belong under the card.
                    const field = viewportRef.current?.querySelector<HTMLTextAreaElement>(
                      '.fo-card-prompt textarea',
                    );
                    if (generation.prompt.trim() || !field) void generation.generate(selected);
                    else {
                      field.focus();
                      toast('在卡片下方写下运镜或动作，再点图生视频');
                    }
                  }}
                  onRegenerate={() => void generation.regenerate(selected)}
                  onResume={() => void generation.resume(selected)}
                  onToggleReference={() => toggleReference(selected.id)}
                  onCycleRole={() =>
                    update(draft => {
                      const card = draft.cards.find(item => item.id === selected.id);
                      if (!card) return;
                      const role = nextRole(card.role);
                      if (role) card.role = role;
                      else delete card.role;
                    })
                  }
                  onAddShot={() => addToSequence(selected.id)}
                  onAddSound={() => {
                    update(draft => void addSound(draft, selected));
                    toast('已放到成片的音频轨 · 在下方点它调整时间和替换方式');
                  }}
                  onDownload={() => void generation.download(selected)}
                  onRemove={removeSelected}
                />
              )}
              <MultiSelectionBar
                selection={canvas.selection}
                cards={project.cards}
                enabled={isActive}
                busy={active}
                toast={toast}
                onAddShots={addToSequence}
                onArrange={arrangeCards}
              />

              {!desktop && composer}
              <ZoomControl
                open={zoomOpen}
                onOpenChange={setZoomOpen}
                active={isActive}
                zoom={canvas.camera.zoom}
                onZoomBy={canvas.zoomBy}
                onZoomToPercent={canvas.zoomTo}
                onFit={() => canvas.fit()}
              />
              <div className="fo-canvas-hint">
                <span>滚动平移</span>
                <i>·</i>
                <span>⌘ / Ctrl + 滚轮缩放</span>
                <i>·</i>
                <span>空格拖动画布</span>
              </div>
              <div className="fo-file-drop-hint">
                松开，添加到画布 <Icon name="upload" />
              </div>
            </main>
            <Sequence
              collapsed={desktop && !timelineOpen}
              onToggle={desktop ? toggleTimeline : undefined}
              project={project}
              update={update}
              onPreview={previewShot}
            />
          </div>
          {desktop && (
            <aside className="fo-generation-sidebar" aria-label="生成面板">
              <header>
                <span>
                  <Icon name="sparkles" />
                  生成
                </span>
                <span>⌘ ↵</span>
              </header>
              {composer}
            </aside>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          className="fo-file-input"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={event => {
            if (event.target.files) void importFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <div
          className={`fo-toast${toastText ? ' is-visible' : ''}`}
          role="status"
          aria-live="polite"
        >
          {toastText}
        </div>
      </div>

      {!desktop && workflowPanel}
      {isActive && preview && (
        <PreviewDialog
          items={preview.items}
          title={preview.title}
          sounds={preview.sounds}
          onClose={closePreview}
        />
      )}
      {isActive && consistencyOpen && (
        <ConsistencyDialog
          notes={project.consistency?.notes ?? ''}
          references={references}
          provider={generation.config.provider}
          onSave={notes =>
            update(draft => {
              const consistency = (draft.consistency ??= { notes: '', references: [] });
              consistency.notes = notes;
            })
          }
          onRemove={id =>
            update(draft => {
              if (draft.consistency)
                draft.consistency.references = draft.consistency.references.filter(
                  ref => ref !== id,
                );
            })
          }
          onClose={() => setConsistencyOpen(false)}
        />
      )}
      {isActive && exporting && (
        <ExportDialog
          shots={exporting.items}
          skipped={exporting.skipped}
          sounds={exporting.sounds}
          title={project.title}
          onClose={closeExport}
        />
      )}
      <APISettings
        open={isActive && settingsOpen}
        notice={settingsNotice}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsNotice('');
        }}
        config={generation.config}
        onChange={value => {
          const connected = !generation.config.key && Boolean(value.key);
          generation.setConfig(value);
          // Never start a paid request on save; return to the kept prompt instead.
          if (connected) {
            toast(
              generation.prompt.trim()
                ? '已连接，提示词还在，点生成即可'
                : '已连接，写下想法就能生成',
            );
            requestAnimationFrame(() => promptRef.current?.focus());
          }
        }}
      />
      <HelpDialog
        open={isActive && helpOpen}
        onClose={() => setHelpOpen(false)}
        onShowIntro={onShowIntro}
      />
    </div>
  );
}
