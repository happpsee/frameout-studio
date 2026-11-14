import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { Card } from '../types';
import { useWorkspace } from './project/useWorkspace';
import { useGeneration } from './generation/useGeneration';
import { useCanvas } from './canvas/useCanvas';
import { useWorkflow } from './generation/useWorkflow';
import { useExampleImport } from '../shell/misc/useExampleImport';
import { useNotes } from './canvas/useNotes';
import { linkedIds } from './canvas/notes';
import { arrange, tidy, type ArrangeMode } from './canvas/canvas-layout';
import { nextRole } from './generation/consistency';
import { thumbnails, wantsOriginal } from './canvas/thumbnails';
import { CanvasNote } from './canvas/CanvasNote';
import CardPrompt from './generation/CardPrompt';
import { cardPrompt, type PromptAction } from './generation/card-prompt';
import { CARD_CENTER, CARD_HEIGHT, CARD_WIDTH, clamp } from './canvas/canvas-camera';
import { DesktopMediaTooLargeError, putMedia } from './project/media-store';
import { readStoredValue } from './project/desktop-storage';
import { desktopBridge, isDesktop } from '../platform';
import { serializeProject, uid } from './project/project';
import { projectDataKeys } from './project/projects';
import APISettings from '../shell/settings/APISettings';
import Icon from '../ui/Icon';
import { CanvasCard, jobNote, pending, visibleCards } from './canvas/CanvasCard';
import { regeneration } from './generation/regenerate';
import Sequence from './film/Sequence';
import PreviewDialog, { type PreviewItem } from './film/PreviewDialog';
import ExportDialog from './film/ExportDialog';
import ConsistencyDialog from './generation/ConsistencyDialog';
import { MAX_REFERENCES, referenceCards, supportsReferences } from './generation/consistency';
import WorkflowPanel from './generation/WorkflowPanel';
import AssetLibrary from './canvas/AssetLibrary';
import StudioHeader, { type StudioView } from './StudioHeader';
import ShotList from './canvas/ShotList';
import CanvasTools, { type PanelTab } from './canvas/CanvasTools';
import SelectionActions from './canvas/SelectionActions';
import MultiSelectionBar, { SelectionMarquee } from './canvas/MultiSelectionBar';
import ZoomControl from './canvas/ZoomControl';
import Composer from './generation/Composer';
import HelpDialog from '../shell/misc/HelpDialog';
import BrowserStorageNotice from '../shell/misc/BrowserStorageNotice';

function clipDuration(card: Card) {
  const duration = card.duration;
  return card.kind === 'video' &&
    typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration > 0
    ? duration
    : 4;
}
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
  const [timelineOpen, setTimelineOpen] = useState(() => project.sequence.length > 0);
  const [preview, setPreview] = useState<{ items: PreviewItem[]; title: string } | null>(null);
  const [exporting, setExporting] = useState<{ items: PreviewItem[]; skipped: number } | null>(
    null,
  );

  const [toastText, setToastText] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Capture before effects: StrictMode cleanup may save a default camera before
  // the second effect setup. That save should not suppress the first fit.
  const [fitOnOpen] = useState(() => needsInitialFit(projectId));
  const didInitialFit = useRef(!fitOnOpen);
  const [layout, setLayout] = useState({
    width: 1200,
    height: 600,
    bottom: 400,
    selectionWidth: 400,
    selectionHeight: 48,
  });

  // Object URLs for imported files, revoked on unmount.
  const uploadedURLs = useRef(new Set<string>());
  const mounted = useRef(true);
  const pendingImports = useRef(new Set<Promise<void>>());
  const toast = useCallback((message: string) => {
    setToastText(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(''), 3300);
  }, []);
  const getProject = useCallback(() => projectRef.current, [projectRef]);
  const openSettings = useCallback((notice = '') => {
    setSettingsNotice(notice);
    setSettingsOpen(true);
  }, []);
  const generation = useGeneration({ getProject, update, toast, openSettings });
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
  const addToSequence = useCallback(
    // Several ids are added in order as one undo step; unfinished media is skipped.
    (ids: string | string[]) => {
      const cards = [ids].flat().flatMap(id => {
        const card = projectRef.current.cards.find(c => c.id === id);
        return card && !card.missingMedia && !pending(card) ? [card] : [];
      });
      if (!cards.length) return;
      update(draft => {
        for (const card of cards)
          draft.sequence.push({
            id: uid(),
            cardId: card.id,
            duration: clamp(clipDuration(card), 1, 15),
          });
      });
      setTimelineOpen(true);
      toast(
        cards.length > 1
          ? `已加入成片 ${cards.length} 个镜头 · 在下方拖动调整顺序`
          : '已加入成片 · 在下方拖动调整顺序',
      );
    },
    [projectRef, update, toast],
  );
  const readFiles = useCallback(
    async (files: FileList, point?: { x: number; y: number }) => {
      const valid = [...files].filter(file => /^(image|video)\//.test(file.type));
      if (!valid.length) {
        toast('请选择图片或视频文件');
        return;
      }
      const cards: Card[] = [];
      const camera = projectRef.current.camera;
      const rect = viewportRef.current?.getBoundingClientRect();
      const origin = point ?? {
        x: ((rect?.width ?? 1000) / 2 - camera.x) / camera.zoom - CARD_CENTER.x,
        y: ((rect?.height ?? 600) / 2 - camera.y) / camera.zoom - CARD_CENTER.y,
      };
      // Repeated pastes or uploads without a drop point must not hide earlier cards underneath.
      if (!point)
        while (
          projectRef.current.cards.some(
            card => Math.abs(card.x - origin.x) < 8 && Math.abs(card.y - origin.y) < 8,
          )
        ) {
          origin.x += 35;
          origin.y += 35;
        }
      for (const [index, file] of valid.entries()) {
        const src = URL.createObjectURL(file);
        uploadedURLs.current.add(src);
        const card: Card = {
          id: uid(),
          x: origin.x + index * 35,
          y: origin.y + index * 35,
          name: file.name.replace(/\.[^.]+$/, ''),
          kind: file.type.startsWith('video/') ? 'video' : 'image',
          src,
          tone: 'normal',
          label: '本地素材',
          mimeType: file.type,
        };
        try {
          card.mediaId = await putMedia(file);
        } catch (error) {
          card.sessionOnly = true;
          if (error instanceof DesktopMediaTooLargeError)
            toast(`${error.message}，请压缩后重新导入`);
          else
            toast(
              isDesktop()
                ? '素材未能保存到本机，请保留原文件'
                : '浏览器未能保存此文件，刷新前请保留原文件',
            );
        }
        cards.push(card);
      }
      if (!mounted.current) {
        cards.forEach(card => {
          URL.revokeObjectURL(card.src);
          uploadedURLs.current.delete(card.src);
        });
        return;
      }
      update(draft => {
        draft.cards.push(...cards);
        draft.selected = cards.at(-1)!.id;
      });
    },
    [projectRef, update, toast],
  );
  const importFiles = useCallback(
    (files: FileList, point?: { x: number; y: number }) => {
      const operation = readFiles(files, point);
      pendingImports.current.add(operation);
      const clear = () => {
        pendingImports.current.delete(operation);
      };
      void operation.then(clear, clear);
      return operation;
    },
    [readFiles],
  );
  useEffect(
    () =>
      desktopBridge()?.onBeforeClose(async () => {
        pauseWorkflow();
        stopGeneration();
        await Promise.all(pendingImports.current);
        await flush();
      }),
    [flush, stopGeneration, pauseWorkflow],
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
  const hasSelection = Boolean(selected);
  const selectedJobStatus = selected?.job?.status;
  const selectedPosition =
    selected && canvas.dragPosition?.id === selected.id ? canvas.dragPosition : selected;
  const removeSelected = useCallback(() => {
    const id = projectRef.current.selected;
    if (!id) return;
    if (active) {
      toast('先停止本页等待，再删除素材');
      return;
    }
    cancelGesture();
    update(draft => {
      draft.cards = draft.cards.filter(c => c.id !== id);
      draft.sequence = draft.sequence.filter(s => s.cardId !== id);
      draft.selected = null;
      if (draft.consistency)
        draft.consistency.references = draft.consistency.references.filter(ref => ref !== id);
    });
  }, [projectRef, active, cancelGesture, update, toast]);
  // Stable callbacks let memoized cards and the sequence skip renders; they call the latest handlers.
  const cardActions = useRef<{
    openPreview: (card?: Card) => void;
    updateDuration: (card: Card, duration: number) => void;
  }>(null!);
  const selectCard = useCallback(
    (id: string) =>
      update(draft => {
        draft.selected = id;
      }, false),
    [update],
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
  const toggleTimeline = useCallback(() => setTimelineOpen(value => !value), []);
  const previewShot = useCallback(
    (card: Card) => {
      update(draft => {
        draft.selected = card.id;
      }, false);
      cardActions.current.openPreview(card);
    },
    [update],
  );
  const toggleReference = useCallback(
    (id: string) => {
      const references = projectRef.current.consistency?.references ?? [];
      const adding = !references.includes(id);
      if (adding && referenceCards(projectRef.current).length >= MAX_REFERENCES) {
        toast(`最多 ${MAX_REFERENCES} 张参考图，请先移除一张`);
        return;
      }
      update(draft => {
        const consistency = (draft.consistency ??= { notes: '', references: [] });
        consistency.references = adding
          ? [...consistency.references.filter(ref => draft.cards.some(card => card.id === ref)), id]
          : consistency.references.filter(ref => ref !== id);
      });
      toast(
        adding
          ? supportsReferences(generation.config.provider)
            ? '已设为参考 · 之后生成的图片会参照它'
            : '已设为参考 · 当前服务只使用统一设定'
          : '已取消参考',
      );
    },
    [projectRef, update, toast, generation.config.provider],
  );
  const arrangeCards = (ids: string[], mode: ArrangeMode) => {
    const positions = arrange(
      projectRef.current.cards.filter(card => ids.includes(card.id)),
      mode,
    );
    update(draft => {
      for (const card of draft.cards) Object.assign(card, positions.get(card.id));
    });
  };
  const tidyCanvas = useCallback(() => {
    const placed = tidy(projectRef.current);
    if (!placed.cards.size && !placed.notes.size) return;
    cancelGesture();
    update(draft => {
      for (const card of draft.cards) Object.assign(card, placed.cards.get(card.id));
      for (const note of draft.notes ?? []) Object.assign(note, placed.notes.get(note.id));
    });
    fitCanvas();
    toast('已整理画布 · 可以撤销');
  }, [projectRef, update, cancelGesture, fitCanvas, toast]);
  const guardedUndo = () => {
    canvas.cancelGesture();
    if (!active) undo();
  };
  const guardedRedo = () => {
    canvas.cancelGesture();
    if (!active) redo();
  };

  useEffect(() => {
    mounted.current = true;
    const urls = uploadedURLs.current;
    return () => {
      mounted.current = false;
      clearTimeout(toastTimer.current);
      urls.forEach(url => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);
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
    setPreview(null);
    setExporting(null);
    setConsistencyOpen(false);
    if (
      document.activeElement instanceof HTMLElement &&
      studioRef.current?.contains(document.activeElement)
    )
      document.activeElement.blur();
  }, [isActive, stopGeneration, cancelGesture]);
  useLayoutEffect(() => {
    if (!isActive) return;
    const measure = () => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return;
      const bottom = desktop
        ? rect.bottom
        : (composerRef.current?.getBoundingClientRect().top ?? rect.bottom);
      setLayout({
        width: rect.width,
        height: rect.height,
        bottom: bottom - rect.top - 12,
        selectionWidth: selectionRef.current?.offsetWidth ?? 400,
        selectionHeight: selectionRef.current?.offsetHeight ?? 48,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (selectionRef.current) observer.observe(selectionRef.current);
    if (composerRef.current) observer.observe(composerRef.current);
    return () => observer.disconnect();
  }, [desktop, isActive, hasSelection, generation.mode, selectedJobStatus]);
  useEffect(() => {
    if (!isActive) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.target as Element)?.closest?.(
          '.fo-work-panel,input,textarea,select,[role="combobox"],[role="listbox"],[contenteditable="true"]',
        ) ||
        document.querySelector('dialog[open]')
      )
        return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        cancelGesture();
        if (!active) {
          if (event.shiftKey) redo();
          else undo();
        }
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        cancelGesture();
        if (!active) redo();
      } else if (mod && ['+', '=', '-'].includes(event.key)) {
        event.preventDefault();
        zoomBy(event.key === '-' ? 1 / 1.2 : 1.2);
      } else if (event.altKey && event.shiftKey && event.code === 'KeyF') {
        event.preventDefault();
        tidyCanvas();
      } else if (event.key === '0') {
        event.preventDefault();
        fitCanvas();
      } else if (['Delete', 'Backspace'].includes(event.key) && projectRef.current.selected) {
        event.preventDefault();
        removeSelected();
      } else if (!mod && event.key.toLowerCase() === 'v') setTool('select');
      else if (!mod && event.key.toLowerCase() === 'h') setTool('hand');
      else if (event.key === 'Escape') {
        setZoomOpen(false);
        update(draft => {
          draft.selected = null;
        }, false);
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [
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
  ]);

  // Shots the preview and export can play: skips missing or unfinished media.
  function sequenceItems(): PreviewItem[] {
    return project.sequence.flatMap(shot => {
      const source = project.cards.find(c => c.id === shot.cardId);
      return source && !source.missingMedia && !pending(source)
        ? [{ card: source, duration: shot.duration }]
        : [];
    });
  }
  function openExport() {
    const items = sequenceItems();
    if (!items.length) {
      toast('成片里还没有可导出的镜头');
      return;
    }
    setExporting({ items, skipped: project.sequence.length - items.length });
  }
  function openPreview(card?: Card) {
    if (card && (card.missingMedia || pending(card))) {
      toast('该素材尚未完成或需要重新导入');
      return;
    }
    const items = card ? [{ card, duration: clipDuration(card) }] : sequenceItems();
    if (!items.length) {
      toast('先选择素材并加入成片，再开始预览');
      return;
    }
    setPreview({ items, title: card?.name ?? project.title });
  }
  function updateDuration(card: Card, duration: number) {
    const current = projectRef.current.cards.find(item => item.id === card.id);
    if (!current || current.src !== card.src || current.duration === duration) return;
    update(draft => {
      const target = draft.cards.find(item => item.id === card.id);
      if (target) target.duration = duration;
    }, false);
  }
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
  let selectionStyle: CSSProperties = {};
  let outside = false;
  let selectedBox = { left: 0, top: 0, right: 0, bottom: 0 };
  let barBottom: number | undefined;
  if (selectedPosition) {
    const left = canvas.camera.x + selectedPosition.x * canvas.camera.zoom;
    const top = canvas.camera.y + selectedPosition.y * canvas.camera.zoom;
    const right = left + CARD_WIDTH * canvas.camera.zoom;
    const bottom = top + CARD_HEIGHT * canvas.camera.zoom;
    outside = right < 0 || left > layout.width || bottom < 0 || top > layout.height;
    let x = clamp(
      (left + right - layout.selectionWidth) / 2,
      12,
      Math.max(12, layout.width - layout.selectionWidth - 12),
    );
    let y = top - layout.selectionHeight - 12;
    if (y < 48) y = bottom + 12;
    y = clamp(y, 48, Math.max(48, layout.bottom - layout.selectionHeight));
    if (!desktop && x < 65 && y < 320) {
      if (70 + layout.selectionWidth < layout.width - 12) x = 70;
      else y = clamp(325, 48, Math.max(48, layout.bottom - layout.selectionHeight));
    }
    selectionStyle = { left: x, top: y };
    selectedBox = { left, top, right, bottom };
    // The bar normally sits above the card; when it had to go below, the prompt goes under it.
    if (y >= bottom) barBottom = y + layout.selectionHeight;
  }
  const promptPlan =
    selected && !canvas.selection.ids.length ? cardPrompt(selected, project.cards) : null;
  const runPrompt = (card: Card, action: PromptAction, prompt: string) => {
    if (action.kind === 'video') void generation.generate(card, { prompt, mode: 'video' });
    else if (action.kind === 'redo')
      void generation.generate(action.source, { prompt, mode: 'video', near: card });
    else
      void generation.generate(undefined, {
        prompt,
        mode: 'image',
        near: card,
        replace: action.replace ? card.id : undefined,
      });
  };
  const sceneStyle = {
    transform: `translate3d(${canvas.camera.x}px,${canvas.camera.y}px,0) scale(${canvas.camera.zoom})`,
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
      onStop={workflow.running ? workflow.pause : generation.stop}
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
              <div className="fo-stage" style={sceneStyle}>
                {visibleCards(project.cards, canvas.camera, layout.width, layout.height, [
                  project.selected,
                  canvas.dragPosition?.id,
                  ...canvas.selection.ids,
                ]).map(card => {
                  const position = canvas.positionOf(card);
                  const dragging = position !== card;
                  return (
                    <CanvasCard
                      key={card.id}
                      card={card}
                      x={position.x}
                      y={position.y}
                      selected={selected?.id === card.id || canvas.selection.ids.includes(card.id)}
                      dragging={dragging}
                      reference={referenceIds.has(card.id)}
                      linked={linked.cards.has(card.id)}
                      original={original}
                      onSelect={selectCard}
                      onOpen={openCard}
                      onDuration={cardDuration}
                    />
                  );
                })}
                {project.notes?.map(note => (
                  <CanvasNote
                    key={note.id}
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
                ))}
              </div>
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
                  onDownload={() => void generation.download(selected)}
                  onRemove={removeSelected}
                />
              )}
              {selected && promptPlan && (
                <CardPrompt
                  key={selected.id}
                  card={selected}
                  plan={promptPlan}
                  box={selectedBox}
                  zoom={canvas.camera.zoom}
                  bounds={{ width: layout.width, bottom: layout.bottom }}
                  barBottom={barBottom}
                  busy={active}
                  onRun={(action, text) => runPrompt(selected, action, text)}
                  toast={toast}
                />
              )}
              <SelectionMarquee rect={canvas.marquee} />
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
          onClose={() => setPreview(null)}
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
          title={project.title}
          onClose={() => setExporting(null)}
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
