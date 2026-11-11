import { useCallback, useEffect, useRef, useState } from 'react';
import { produce } from 'immer';
import type { ProjectState, UpdateProject } from '../types';
import { initialState, restoreProject, serializeProject, serializeWorkspace, STORAGE_KEY, uid } from '../lib/project';
import { getMedia } from '../lib/media-store';
import { flushDesktopStorage, readStoredValue, writeStoredValue } from '../lib/desktop-storage';
import { recordEvent } from '../lib/workflow';

type Snapshot = Pick<ProjectState, 'cards' | 'sequence' | 'selected' | 'title'>;
// Project states are immutable (Immer), so undo entries can share them instead of copying.
const snapshot = (project: ProjectState): Snapshot => ({ cards: project.cards, sequence: project.sequence, selected: project.selected, title: project.title });
function restore() { try { return restoreProject(JSON.parse(readStoredValue(STORAGE_KEY) || 'null')); } catch { return initialState(); } }

export function useWorkspace() {
  const [project, setProject] = useState(restore);
  const projectRef = useRef(project);
  const savedLabel = window.frameoutDesktop ? '已保存到本机' : '已保存到此浏览器';
  const [saveStatus, setSaveStatus] = useState(savedLabel);
  const undoStack = useRef<Snapshot[]>([]), redoStack = useRef<Snapshot[]>([]);
  const hydratedMedia = useRef(new Map<string, string>());
  const [, renderHistory] = useState(0);
  const update: UpdateProject = useCallback((recipe, record = true) => {
    const next = produce(projectRef.current, recipe);
    if (next === projectRef.current) return;
    if (record) {
      undoStack.current.push(snapshot(projectRef.current));
      if (undoStack.current.length > 40) undoStack.current.shift();
      redoStack.current = [];
    }
    projectRef.current = next; setProject(next);
  }, []);
  const history = useCallback((redo: boolean) => {
    const from = redo ? redoStack.current : undoStack.current;
    const to = redo ? undoStack.current : redoStack.current;
    const next = from.pop();
    if (!next) return;
    to.push(snapshot(projectRef.current));
    const cards = next.cards.map(card => {
      const src = card.mediaId && hydratedMedia.current.get(card.mediaId);
      return src && (card.src !== src || card.missingMedia) ? { ...card, src, missingMedia: false } : card;
    });
    const value = { ...projectRef.current, ...next, cards };
    projectRef.current = value; setProject(value); renderHistory(n => n + 1);
  }, []);
  const createCheckpoint = useCallback((name: string) => {
    if (projectRef.current.cards.some(card => card.sessionOnly)) throw new Error('请先保存或移除仅本次可用的素材，再创建版本');
    const checkpoint = { id: uid(), name: name.trim().slice(0, 80) || '手动版本', createdAt: Date.now(), state: serializeWorkspace(projectRef.current) };
    update(draft => { draft.checkpoints = [...(draft.checkpoints || []), checkpoint].slice(-8); }, false);
    return checkpoint.id;
  }, [update]);
  const restoreCheckpoint = useCallback((id: string) => {
    const checkpoint = projectRef.current.checkpoints?.find(item => item.id === id);
    if (!checkpoint) throw new Error('该版本已不可用');
    const restored = restoreProject(checkpoint.state);
    createCheckpoint('恢复前自动备份');
    update(draft => {
      Object.assign(draft, { title: restored.title, camera: restored.camera, selected: restored.selected, cards: restored.cards, sequence: restored.sequence });
      if (draft.workflow) {
        draft.workflow.status = 'paused';
        for (const step of draft.workflow.steps) {
          if (step.outputCardId && !restored.cards.some(card => card.id === step.outputCardId)) {
            step.status = 'cancelled'; step.error = '此步骤的素材已随版本切换移出画布';
          }
        }
        recordEvent(draft.workflow, `已恢复版本 ${checkpoint.name}`);
      }
    });
  }, [update, createCheckpoint]);
  const saveProject = useCallback(() => writeStoredValue(STORAGE_KEY, JSON.stringify(serializeProject(projectRef.current))), []);
  const flush = useCallback(async () => {
    await saveProject();
    await flushDesktopStorage();
    if (window.frameoutDesktop && projectRef.current.cards.some(card => card.sessionOnly)) throw new Error('部分素材未保存到本机');
  }, [saveProject]);
  const persist = useCallback((report = true) => {
    const snapshot = projectRef.current;
    const success = () => {
      if (report && snapshot === projectRef.current) setSaveStatus(snapshot.cards.some(card => card.sessionOnly) ? '已保存 · 部分素材仅本次可用' : savedLabel);
    };
    const failure = () => { if (report && snapshot === projectRef.current) setSaveStatus('保存不可用 · 请导出项目'); };
    try {
      const write = saveProject();
      if (write) void write.then(success, failure); else success();
    } catch { failure(); }
  }, [saveProject, savedLabel]);
  useEffect(() => { setSaveStatus('正在保存'); const timer = setTimeout(persist, 300); return () => clearTimeout(timer); }, [project, persist]);
  useEffect(() => {
    const save = () => persist(false);
    const onVisibility = () => { if (document.visibilityState === 'hidden') save(); };
    window.addEventListener('pagehide', save); document.addEventListener('visibilitychange', onVisibility);
    return () => { save(); window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', onVisibility); };
  }, [persist]);
  const missingMediaKey = project.cards.filter(card => card.mediaId && card.missingMedia).map(card => `${card.id}:${card.mediaId}`).join('|');
  useEffect(() => {
    let cancelled = false;
    const pending = projectRef.current.cards.filter(card => card.mediaId && card.missingMedia);
    void Promise.all(pending.map(async card => {
      try {
        const blob = await getMedia(card.mediaId!);
        if (cancelled || !blob) return;
        const previous = hydratedMedia.current.get(card.mediaId!);
        const url = previous || URL.createObjectURL(blob);
        hydratedMedia.current.set(card.mediaId!, url);
        update(draft => { const target = draft.cards.find(c => c.id === card.id && c.mediaId === card.mediaId); if (target) { target.src = url; target.missingMedia = false; } }, false);
      } catch { /* Leave a visible missing-media placeholder. */ }
    }));
    return () => { cancelled = true; };
  }, [update, missingMediaKey]);
  useEffect(() => () => { hydratedMedia.current.forEach(url => URL.revokeObjectURL(url)); hydratedMedia.current.clear(); }, []);
  return { project, projectRef, update, undo: useCallback(() => history(false), [history]), redo: useCallback(() => history(true), [history]), canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0, saveStatus, flush, createCheckpoint, restoreCheckpoint };
}
