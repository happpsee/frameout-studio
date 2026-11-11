import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Card, GenerationMode } from '../types';
import { useWorkspace } from '../hooks/useWorkspace';
import { useGeneration } from '../hooks/useGeneration';
import { useCanvas } from '../hooks/useCanvas';
import { useWorkflow } from '../hooks/useWorkflow';
import { clamp } from '../lib/canvas-camera';
import { DesktopMediaTooLargeError, putMedia } from '../lib/media-store';
import { readStoredValue } from '../lib/desktop-storage';
import { serializeProject, STORAGE_KEY } from '../lib/project';
import APISettings from './APISettings';
import Icon from './Icon';
import Select from './Select';
import { CanvasCard, pending, videoStatus, visibleCards } from './CanvasCard';
import Sequence from './Sequence';
import PreviewDialog, { type PreviewItem } from './PreviewDialog';
import WorkflowPanel from './WorkflowPanel';
import AssetLibrary from './AssetLibrary';
import DesktopGenerationSettings from './DesktopGenerationSettings';

const uid = () => 'f-' + crypto.randomUUID();
const modeOptions = [{ value: 'image', label: '图片' }, { value: 'video', label: '视频' }];
function clipDuration(card: Card) {
  const duration = card.duration;
  return card.kind === 'video' && typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 4;
}
function needsInitialFit() {
  try {
    const saved = JSON.parse(readStoredValue(STORAGE_KEY) || 'null');
    return !(saved?.version === 1 && Array.isArray(saved.cards) && Array.isArray(saved.sequence) && ['x', 'y', 'zoom'].every(key => Number.isFinite(saved.camera?.[key])));
  } catch { return true; }
}

export default function Studio({ onClose, active: isActive = true }: { onClose: () => void; active?: boolean }) {
  const desktop = Boolean(window.frameoutDesktop);
  const { project, projectRef, update, undo, redo, canUndo, canRedo, saveStatus, flush, createCheckpoint, restoreCheckpoint } = useWorkspace();
  const viewportRef = useRef<HTMLElement>(null), composerRef = useRef<HTMLFormElement>(null), selectionRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null), promptRef = useRef<HTMLTextAreaElement>(null), helpRef = useRef<HTMLDialogElement>(null), zoomRef = useRef<HTMLDivElement>(null), zoomButtonRef = useRef<HTMLButtonElement>(null);
  const [toastText, setToastText] = useState(''), toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false), [helpOpen, setHelpOpen] = useState(false), [zoomOpen, setZoomOpen] = useState(false), [zoomText, setZoomText] = useState('80');
  const [panelTab, setPanelTab] = useState<'workflow' | 'versions' | null>(null);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(() => project.sequence.length > 0);
  const [preview, setPreview] = useState<{ items: PreviewItem[]; title: string } | null>(null);
  // Capture before effects: StrictMode cleanup may save a default camera before
  // the second effect setup. That save should not suppress the first fit.
  const [fitOnOpen] = useState(needsInitialFit);
  const didInitialFit = useRef(!fitOnOpen), studioRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ width: 1200, height: 600, bottom: 400, selectionWidth: 400, selectionHeight: 48 });
  const uploadedURLs = useRef(new Set<string>()), mounted = useRef(true);
  const pendingImports = useRef(new Set<Promise<void>>());
  const toast = useCallback((message: string) => { setToastText(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToastText(''), 3300); }, []);
  const getProject = useCallback(() => projectRef.current, [projectRef]);
  const generation = useGeneration({ getProject, update, toast });
  const workflow = useWorkflow({ project, projectRef, update, generation, flush, createCheckpoint, toast, enabled: isActive });
  const active = generation.active || workflow.running || workflow.settling;
  const generationActive = useRef(active); generationActive.current = active;
  const addToSequence = useCallback((id: string) => {
    const card = projectRef.current.cards.find(c => c.id === id);
    if (!card || card.missingMedia || pending(card)) return;
    update(draft => { draft.sequence.push({ id: uid(), cardId: id, duration: clamp(clipDuration(card), 1, 15) }); });
    setTimelineOpen(true);
    toast('已加入成片 · 在下方拖动调整顺序');
  }, [projectRef, update, toast]);
  const readFiles = useCallback(async (files: FileList, point?: { x: number; y: number }) => {
    const valid = [...files].filter(file => /^(image|video)\//.test(file.type));
    if (!valid.length) { toast('请选择图片或视频文件'); return; }
    const cards: Card[] = [];
    const camera = projectRef.current.camera;
    const rect = viewportRef.current?.getBoundingClientRect();
    const origin = point ?? { x: ((rect?.width ?? 1000) / 2 - camera.x) / camera.zoom - 135, y: ((rect?.height ?? 600) / 2 - camera.y) / camera.zoom - 110 };
    for (const [index, file] of valid.entries()) {
      const src = URL.createObjectURL(file); uploadedURLs.current.add(src);
      const card: Card = { id: uid(), x: origin.x + index * 35, y: origin.y + index * 35, name: file.name.replace(/\.[^.]+$/, ''), kind: file.type.startsWith('video/') ? 'video' : 'image', src, tone: 'normal', label: '本地素材', mimeType: file.type };
      try { card.mediaId = await putMedia(file); }
      catch (error) {
        card.sessionOnly = true;
        if (error instanceof DesktopMediaTooLargeError) toast(`${error.message}，请压缩后重新导入`);
        else toast(window.frameoutDesktop ? '素材未能保存到本机，请保留原文件' : '浏览器未能保存此文件，刷新前请保留原文件');
      }
      cards.push(card);
    }
    if (!mounted.current) { cards.forEach(card => { URL.revokeObjectURL(card.src); uploadedURLs.current.delete(card.src); }); return; }
    update(draft => { draft.cards.push(...cards); draft.selected = cards.at(-1)!.id; });
  }, [projectRef, update, toast]);
  const importFiles = useCallback((files: FileList, point?: { x: number; y: number }) => {
    const operation = readFiles(files, point);
    pendingImports.current.add(operation);
    const clear = () => { pendingImports.current.delete(operation); };
    void operation.then(clear, clear);
    return operation;
  }, [readFiles]);
  useEffect(() => window.frameoutDesktop?.onBeforeClose(async () => {
    workflow.pause();
    generation.stop();
    await Promise.all(pendingImports.current);
    await flush();
  }), [flush, generation.stop, workflow.pause]);
  const canvas = useCanvas({ active: isActive, viewportRef, projectRef, update, addToSequence, onFiles: importFiles, onBackgroundDoubleClick: () => promptRef.current?.focus() });
  const selected = project.cards.find(card => card.id === project.selected);
  const selectedPosition = selected && canvas.dragPosition?.id === selected.id ? canvas.dragPosition : selected;
  const removeSelected = useCallback(() => {
    const id = projectRef.current.selected;
    if (!id) return;
    if (active) { toast('先停止本页等待，再删除素材'); return; }
    canvas.cancelGesture();
    update(draft => { draft.cards = draft.cards.filter(c => c.id !== id); draft.sequence = draft.sequence.filter(s => s.cardId !== id); draft.selected = null; });
  }, [projectRef, active, canvas.cancelGesture, update, toast]);
  // Stable callbacks let memoized cards and the sequence skip renders; they call the latest handlers.
  const cardActions = useRef<{ openPreview: (card?: Card) => void; updateDuration: (card: Card, duration: number) => void }>(null!);
  const selectCard = useCallback((id: string) => update(draft => { draft.selected = id; }, false), [update]);
  const openCard = useCallback((id: string) => { const card = projectRef.current.cards.find(c => c.id === id); if (card) cardActions.current.openPreview(card); }, [projectRef]);
  const cardDuration = useCallback((card: Card, duration: number) => cardActions.current.updateDuration(card, duration), []);
  const toggleTimeline = useCallback(() => setTimelineOpen(value => !value), []);
  const previewShot = useCallback((card: Card) => { update(draft => { draft.selected = card.id; }, false); cardActions.current.openPreview(card); }, [update]);
  const guardedUndo = () => { canvas.cancelGesture(); if (!active) undo(); };
  const guardedRedo = () => { canvas.cancelGesture(); if (!active) redo(); };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(toastTimer.current); uploadedURLs.current.forEach(url => URL.revokeObjectURL(url)); uploadedURLs.current.clear(); };
  }, []);
  useEffect(() => {
    if (!isActive || didInitialFit.current) return;
    const frame = requestAnimationFrame(() => { canvas.fit(false); didInitialFit.current = true; });
    return () => cancelAnimationFrame(frame);
  }, [isActive, canvas.fit]);
  useEffect(() => {
    if (isActive) return;
    if (generationActive.current) generation.stop();
    canvas.cancelGesture();
    setSettingsOpen(false); setHelpOpen(false); setZoomOpen(false); setPreview(null);
    if (document.activeElement instanceof HTMLElement && studioRef.current?.contains(document.activeElement)) document.activeElement.blur();
  }, [isActive, generation.stop, canvas.cancelGesture]);
  useEffect(() => { if (isActive && helpOpen) helpRef.current?.showModal(); else helpRef.current?.close(); }, [isActive, helpOpen]);
  useLayoutEffect(() => {
    if (!isActive) return;
    const measure = () => {
      const rect = viewportRef.current?.getBoundingClientRect(); if (!rect?.width || !rect.height) return;
      const bottom = desktop ? rect.bottom : composerRef.current?.getBoundingClientRect().top ?? rect.bottom;
      setLayout({ width: rect.width, height: rect.height, bottom: bottom - rect.top - 12, selectionWidth: selectionRef.current?.offsetWidth ?? 400, selectionHeight: selectionRef.current?.offsetHeight ?? 48 });
    };
    measure(); const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (selectionRef.current) observer.observe(selectionRef.current);
    if (composerRef.current) observer.observe(composerRef.current);
    return () => observer.disconnect();
  }, [desktop, isActive, Boolean(selected), generation.mode, selected?.job?.status]);
  useEffect(() => {
    if (!isActive || !zoomOpen) return;
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !zoomRef.current?.contains(event.target)) setZoomOpen(false); };
    document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close);
  }, [isActive, zoomOpen]);
  useEffect(() => {
    if (!isActive) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as Element)?.closest?.('.fo-work-panel,input,textarea,select,[role="combobox"],[role="listbox"],[contenteditable="true"]') || document.querySelector('dialog[open]')) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); canvas.cancelGesture(); if (!active) { if (event.shiftKey) redo(); else undo(); } }
      else if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); canvas.cancelGesture(); if (!active) redo(); }
      else if (mod && ['+', '=', '-'].includes(event.key)) { event.preventDefault(); canvas.zoomBy(event.key === '-' ? 1 / 1.2 : 1.2); }
      else if (event.key === '0') { event.preventDefault(); canvas.fit(); }
      else if (['Delete', 'Backspace'].includes(event.key) && projectRef.current.selected) { event.preventDefault(); removeSelected(); }
      else if (!mod && event.key.toLowerCase() === 'v') canvas.setTool('select');
      else if (!mod && event.key.toLowerCase() === 'h') canvas.setTool('hand');
      else if (event.key === 'Escape') { setZoomOpen(false); update(draft => { draft.selected = null; }, false); }
    };
    document.addEventListener('keydown', keydown); return () => document.removeEventListener('keydown', keydown);
  }, [isActive, active, undo, redo, canvas.cancelGesture, canvas.fit, canvas.zoomBy, canvas.setTool, projectRef, removeSelected, update]);

  function openPreview(card?: Card) {
    if (card && (card.missingMedia || pending(card))) { toast('该素材尚未完成或需要重新导入'); return; }
    const items = card ? [{ card, duration: clipDuration(card) }] : project.sequence.flatMap(shot => { const source = project.cards.find(c => c.id === shot.cardId); return source && !source.missingMedia && !pending(source) ? [{ card: source, duration: shot.duration }] : []; });
    if (!items.length) { toast('先选择素材并加入成片，再开始预览'); return; }
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
    const exported = { ...serializeProject(projectRef.current), exportedAt: new Date().toISOString() };
    const data = JSON.stringify(exported, (key, value) => /^(?:key|apiKey|authorization)$/i.test(key) ? undefined : value, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${project.title || 'frameout'}-项目.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出项目结构；本地素材文件需另外保留');
  }
  function closeZoom() { setZoomOpen(false); zoomButtonRef.current?.focus({ preventScroll: true }); }
  function setZoom(value: number) { if (Number.isFinite(value) && value > 0) { canvas.zoomTo(clamp(value, 15, 400)); closeZoom(); } }
  let selectionStyle: CSSProperties = {}, outside = false;
  if (selectedPosition) {
    const left = canvas.camera.x + selectedPosition.x * canvas.camera.zoom, top = canvas.camera.y + selectedPosition.y * canvas.camera.zoom;
    const right = left + 270 * canvas.camera.zoom, bottom = top + 219 * canvas.camera.zoom;
    outside = right < 0 || left > layout.width || bottom < 0 || top > layout.height;
    let x = clamp((left + right - layout.selectionWidth) / 2, 12, Math.max(12, layout.width - layout.selectionWidth - 12));
    let y = top - layout.selectionHeight - 12;
    if (y < 48) y = bottom + 12;
    y = clamp(y, 48, Math.max(48, layout.bottom - layout.selectionHeight));
    if (!desktop && x < 65 && y < 320) { if (70 + layout.selectionWidth < layout.width - 12) x = 70; else y = clamp(325, 48, Math.max(48, layout.bottom - layout.selectionHeight)); }
    selectionStyle = { left: x, top: y };
  }
  const sceneStyle = { transform: `translate3d(${canvas.camera.x}px,${canvas.camera.y}px,0) scale(${canvas.camera.zoom})` };
  const taskNote = selected?.job && pending(selected) ? `${videoStatus(selected)} · ${selected.job.id || '尚未取得任务号'}${selected.job.error ? ` · ${selected.job.error}` : ''}` : selected?.remoteTemporary ? '供应商素材链接可能过期，请及时下载保存。' : '';

  const openPanel = (tab: 'workflow' | 'versions') => {
    setAssetsOpen(false);
    setPanelTab(current => current === tab ? null : tab);
  };
  const focusCard = (card: Card) => {
    canvas.cancelGesture();
    update(draft => { draft.selected = card.id; }, false);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect) canvas.restoreCamera({ zoom: canvas.camera.zoom, x: rect.width / 2 - (card.x + 135) * canvas.camera.zoom, y: rect.height / 2 - (card.y + 110) * canvas.camera.zoom });
  };
  const brand = <><span className="fo-brand-mark">F<span>↗</span></span><span>FRAMEOUT<span className="fo-brand-zh">帧外</span></span></>;
  const composer = <form ref={composerRef} className={`fo-composer${active ? ' is-busy' : ''}`} onSubmit={event => { event.preventDefault(); if (!active) void generation.generate(); }}>
        <div className="fo-composer-top"><label htmlFor="fo-prompt">{desktop ? '提示词' : '让想法，先有一个画面。'}</label><Select className="fo-generation-mode" value={generation.mode} onChange={value => generation.setMode(value as GenerationMode)} options={modeOptions} label="生成模式" disabled={active} /></div>
        <textarea ref={promptRef} className="fo-prompt" id="fo-prompt" rows={2} placeholder="描述你想生成的画面或镜头…" maxLength={4000} value={generation.prompt} onChange={event => generation.setPrompt(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void generation.generate(); } }} />
        {desktop && <DesktopGenerationSettings config={generation.config} video={generation.mode === 'video'} disabled={active} onChange={generation.setConfig} onSettings={() => setSettingsOpen(true)} />}
        {taskNote && <p className="fo-task-note" role="status">{taskNote}</p>}
        <div className="fo-composer-bottom"><span className="fo-generation-state">{active ? '正在等待供应商结果…' : generation.config.key ? `${generation.config.provider.toUpperCase()} · ${generation.mode === 'video' ? generation.config.videoModel : generation.config.imageModel}` : '先配置 API Key，再开始生成'}</span>{active && <button type="button" className="fo-cancel-generation" onClick={workflow.running ? workflow.pause : generation.stop}>停止等待</button>}<button type="submit" className="fo-generate-button" disabled={active}><Icon name="sparkles" /><span>{generation.mode === 'video' ? '生成视频' : '生成图片'}</span><Icon name="arrow-up-right" /></button></div><div className="fo-generation-line" />
      </form>;
  const canvasTools = <aside className="fo-canvas-tools" aria-label="画布工具">
        <button type="button" className={`fo-icon-button${canvas.tool === 'select' ? ' is-active' : ''}`} aria-label="选择工具" aria-pressed={canvas.tool === 'select'} title="选择素材 · V" onClick={() => canvas.setTool('select')}><Icon name="cursor" /></button>
        <button type="button" className={`fo-icon-button${canvas.tool === 'hand' ? ' is-active' : ''}`} aria-label="移动画布工具" aria-pressed={canvas.tool === 'hand'} title="移动画布 · H / 空格" onClick={() => canvas.setTool('hand')}><Icon name="hand" /></button><span className="fo-tool-divider" />
        <button type="button" className="fo-icon-button" aria-label="添加本地素材" title="添加本地图片或视频" onClick={() => fileInput.current?.click()}><Icon name="upload" /></button>
        {desktop && <>
          <button type="button" className={`fo-icon-button${assetsOpen ? ' is-active' : ''}`} aria-label="项目素材" title="项目素材" aria-expanded={assetsOpen} onClick={() => { setPanelTab(null); setAssetsOpen(value => !value); }}><Icon name="grid" /></button>
          <button type="button" className={`fo-icon-button${panelTab === 'workflow' ? ' is-active' : ''}`} aria-label="镜头计划" title="镜头计划" aria-expanded={panelTab === 'workflow'} onClick={() => openPanel('workflow')}><Icon name="film" /></button>
          <button type="button" className={`fo-icon-button${panelTab === 'versions' ? ' is-active' : ''}`} aria-label="版本记录" title="版本记录" aria-expanded={panelTab === 'versions'} onClick={() => openPanel('versions')}><Icon name="clock" /></button>
          <span className="fo-tool-divider" />
        </>}
        <button type="button" className="fo-icon-button" aria-label="撤销" title="撤销 · ⌘ / Ctrl Z" disabled={!canUndo || active} onClick={guardedUndo}><Icon name="undo" /></button><button type="button" className="fo-icon-button" aria-label="重做" title="重做 · ⇧ ⌘ Z" disabled={!canRedo || active} onClick={guardedRedo}><Icon name="redo" /></button><span className="fo-tool-divider" /><button type="button" className="fo-icon-button" aria-label="打开使用指南" onClick={() => setHelpOpen(true)}><Icon name="help" /></button>
      </aside>;
  const workflowPanel = isActive && panelTab && <WorkflowPanel tab={panelTab} onTab={setPanelTab} onClose={() => setPanelTab(null)} project={project} workflow={workflow} busy={active} createCheckpoint={createCheckpoint} restoreCheckpoint={id => { canvas.cancelGesture(); restoreCheckpoint(id); canvas.restoreCamera(projectRef.current.camera); }} toast={toast} selectCard={id => update(draft => { draft.selected = id; }, false)} />;

  return <div ref={studioRef} id="studio-root" className={`fo-studio${desktop ? ' is-desktop' : ''}`} hidden={!isActive}><div className="fo-app">
    <header className="fo-header">
      <div className="fo-brand-slot">{desktop ? <div className="fo-brand" aria-label="帧外 FRAMEOUT">{brand}</div> : <button type="button" className="fo-brand" aria-label="返回 FRAMEOUT 首页" onClick={() => { canvas.cancelGesture(); onClose(); }}>{brand}</button>}</div>
      <div className="fo-project"><span className="fo-project-divider">/</span><div><span className="fo-project-title">{project.title}</span><span className="fo-save"><i /><span className="fo-save-label">{saveStatus}</span></span></div></div>
      {!desktop && <nav className="fo-workspace-tabs" aria-label="工作区"><button type="button" className="is-active" aria-current="page">画布</button><button type="button" onClick={() => setHelpOpen(true)}>使用指南 <Icon name="arrow-up-right" /></button></nav>}
      <div className="fo-header-actions">{!desktop && <button type="button" className="fo-text-button fo-flow-button" aria-expanded={panelTab !== null} onClick={() => setPanelTab(value => value ? null : 'workflow')}>镜头计划</button>}{!desktop && <button type="button" className="fo-text-button fo-api-button" aria-label="API 设置" onClick={() => setSettingsOpen(true)}><Icon name="settings" /><span>API 设置</span></button>}<button type="button" className="fo-text-button fo-export-button" aria-label="导出项目" onClick={exportProject}><Icon name="download" /><span>导出项目</span></button><button type="button" className="fo-primary-button" disabled={!project.sequence.length} onClick={() => openPreview()}><Icon name="play" /><span>预览成片</span></button></div>
    </header>
    <div className="fo-workspace-body">
      {desktop && <nav className="fo-desktop-rail" aria-label="工作台工具">{canvasTools}</nav>}
      {desktop && assetsOpen && <AssetLibrary cards={project.cards} selected={project.selected} onSelect={focusCard} onUpload={() => fileInput.current?.click()} onClose={() => setAssetsOpen(false)} />}
      {desktop && workflowPanel}
      <div className="fo-workspace-center">
    <main ref={viewportRef} className={`fo-viewport${canvas.tool === 'hand' || canvas.space ? ' is-hand' : ''}${canvas.panning ? ' is-panning' : ''}${canvas.fileDrop ? ' is-file-drop' : ''}`} aria-label="无限创作画布" style={{ backgroundSize: `${26 * canvas.camera.zoom}px ${26 * canvas.camera.zoom}px`, backgroundPosition: `${canvas.camera.x}px ${canvas.camera.y}px` }}>
      <div className="fo-canvas-intro"><span className="fo-eyebrow">{desktop ? '画布' : 'YOUR CREATIVE SPACE'}</span><span className="fo-canvas-count">{project.cards.length} 个素材</span></div>
      <div className="fo-stage" style={sceneStyle}>
        {visibleCards(project.cards, canvas.camera, layout.width, layout.height, [project.selected, canvas.dragPosition?.id]).map(card => {
          const dragging = canvas.dragPosition?.id === card.id, position = dragging ? canvas.dragPosition! : card;
          return <CanvasCard key={card.id} card={card} x={position.x} y={position.y} selected={selected?.id === card.id} dragging={dragging} onSelect={selectCard} onOpen={openCard} onDuration={cardDuration} />;
        })}
      </div>
      {!project.cards.length && <div className="fo-canvas-empty">{desktop ? <><div className="fo-empty-symbol"><Icon name="grid" /></div><h2>从第一个画面开始</h2></> : <span>MAKE A SCENE.</span>}<p>上传图片或视频，也可以输入提示词生成素材。</p><button type="button" className="fo-primary-button" onClick={() => fileInput.current?.click()}>添加素材 <Icon name="plus" /></button></div>}

      {!desktop && canvasTools}
      {selected && <div ref={selectionRef} className={`fo-selection-actions${outside ? ' is-outside' : ''}`} style={selectionStyle} aria-hidden={outside}>
        <span className="fo-selected-name">{selected.name}</span><button type="button" className="fo-small-button" disabled={active || selected.kind === 'video' || selected.missingMedia || pending(selected)} onClick={() => { void generation.generate(selected); }}><Icon name="film" /><span>图生视频</span></button>
        {pending(selected) && <button type="button" className="fo-small-button" disabled={active} onClick={() => { void generation.resume(selected); }}><Icon name="clock" /><span>继续查询</span></button>}
        <button type="button" className="fo-small-button fo-add-shot" disabled={pending(selected) || selected.missingMedia} onClick={() => addToSequence(selected.id)}><Icon name="plus" /><span>加入成片</span></button>
        {selected.provider && <button type="button" className="fo-icon-button" aria-label="下载生成素材" disabled={pending(selected) || selected.missingMedia} onClick={() => { void generation.download(selected); }}><Icon name="download" /></button>}<button type="button" className="fo-icon-button" aria-label="删除选中素材" disabled={active} onClick={removeSelected}><Icon name="trash" /></button>
      </div>}

      {!desktop && composer}
      <div ref={zoomRef} className="fo-camera-tools" aria-label="缩放控制"><button type="button" className="fo-icon-button" aria-label="缩小" onClick={() => canvas.zoomBy(1 / 1.2)}><Icon name="minus" /></button><button ref={zoomButtonRef} type="button" className="fo-zoom-label" aria-expanded={zoomOpen} aria-controls="fo-zoom-popover" aria-haspopup="dialog" aria-label="缩放比例选项" onClick={() => { setZoomText(String(Math.round(canvas.camera.zoom * 100))); setZoomOpen(value => !value); }}>{Math.round(canvas.camera.zoom * 100)}%</button><button type="button" className="fo-icon-button" aria-label="放大" onClick={() => canvas.zoomBy(1.2)}><Icon name="plus" /></button><span className="fo-tool-divider" /><button type="button" className="fo-icon-button" aria-label="适应全部素材" onClick={() => canvas.fit()}><Icon name="maximize" /></button>
        {zoomOpen && <div className="fo-zoom-popover" id="fo-zoom-popover" role="dialog" aria-label="画布缩放" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeZoom(); } }}><form className="fo-zoom-form" onSubmit={event => { event.preventDefault(); setZoom(Number(zoomText.trim().replace(/%$/, ''))); }}><label htmlFor="fo-zoom-input">缩放比例</label><div><input autoFocus className="fo-zoom-input" id="fo-zoom-input" inputMode="decimal" aria-label="缩放比例" value={zoomText} onChange={event => setZoomText(event.target.value)} onFocus={event => event.target.select()} /><span>%</span><button type="submit">应用</button></div></form><div className="fo-zoom-presets">{[50, 100, 200].map(value => <button type="button" key={value} onClick={() => setZoom(value)}>{value}%</button>)}</div><button type="button" className="fo-zoom-fit" onClick={() => { canvas.fit(); closeZoom(); }}>适应全部素材<span>⌘ / Ctrl 0</span></button></div>}
      </div>
      <div className="fo-canvas-hint"><span>滚动平移</span><i>·</i><span>⌘ / Ctrl + 滚轮缩放</span><i>·</i><span>空格拖动画布</span></div><div className="fo-file-drop-hint">松开，添加到画布 <Icon name="upload" /></div>
    </main>
    <Sequence collapsed={desktop && !timelineOpen} onToggle={desktop ? toggleTimeline : undefined} project={project} update={update} onPreview={previewShot} />
      </div>
      {desktop && <aside className="fo-generation-sidebar" aria-label="生成面板"><header><span><Icon name="sparkles" />生成</span><span>⌘ ↵</span></header>{composer}</aside>}
    </div>
    <input ref={fileInput} type="file" className="fo-file-input" accept="image/*,video/*" multiple hidden onChange={event => { if (event.target.files) void importFiles(event.target.files); event.target.value = ''; }} />
    <div className={`fo-toast${toastText ? ' is-visible' : ''}`} role="status" aria-live="polite">{toastText}</div>
  </div>

  {!desktop && workflowPanel}
  {isActive && preview && <PreviewDialog items={preview.items} title={preview.title} onClose={() => setPreview(null)} />}
  <APISettings open={isActive && settingsOpen} onClose={() => setSettingsOpen(false)} config={generation.config} onChange={generation.setConfig} />
  <dialog ref={helpRef} className="fo-help-dialog" aria-labelledby="fo-help-heading" onCancel={() => setHelpOpen(false)} onClose={() => setHelpOpen(false)} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) setHelpOpen(false); } }}><button type="button" className="fo-icon-button fo-help-close" aria-label="关闭使用指南" onClick={() => setHelpOpen(false)}><Icon name="x" /></button><span className="fo-eyebrow">A LITTLE GUIDE</span><h2 id="fo-help-heading">把想法摊开，<br />再把故事连起来。</h2><p>画布用来探索和比较。只有加入下方成片区的镜头，才会按顺序播放。</p><dl><div><dt>平移画布</dt><dd>滚轮 / 触控板滚动 · 拖动空白处<br />空格 + 拖动，或鼠标中键</dd></div><div><dt>缩放画布</dt><dd>触控板捏合 · ⌘ / Ctrl + 滚轮<br />⌘ / Ctrl ＋ / −，或点击比例</dd></div><div><dt>触屏操作</dt><dd>单指拖动 · 双指平移与缩放</dd></div><div><dt>查看素材</dt><dd>单击选择，双击预览</dd></div><div><dt>撤销 / 重做</dt><dd>⌘ / Ctrl Z · ⇧ ⌘ / Ctrl Z</dd></div><div><dt>删除素材</dt><dd>选中后按 Delete / Backspace</dd></div><div><dt>适应画布</dt><dd>按 0，或点击适应按钮</dd></div></dl><div className="fo-help-note"><strong>从参考图到镜头，再到你的故事。</strong><span>生成图片和视频前，请在 API 设置中填写供应商密钥。{window.frameoutDesktop ? '项目和本地素材自动保存到本机。供应商临时链接请及时下载。' : '素材保存在本浏览器或供应商临时链接，请及时下载。'}成片区支持顺序预览，尚不导出编码后的 MP4。</span></div>{desktop && <button type="button" className="fo-help-intro" onClick={() => { setHelpOpen(false); onClose(); }}>查看产品介绍 <Icon name="arrow-up-right" /></button>}<button type="button" className="fo-primary-button" onClick={() => setHelpOpen(false)}>开始探索 <Icon name="arrow-up-right" /></button></dialog>
  </div>;
}
