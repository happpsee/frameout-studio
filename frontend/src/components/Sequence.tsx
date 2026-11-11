import { useState } from 'react';
import type { Card, ProjectState, UpdateProject } from '../types';
import { CardMedia } from './CardMedia';
import Icon from './Icon';
import Select from './Select';

export const timeLabel = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const durations = Array.from({ length: 15 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} 秒` }));
export default function Sequence({ project, update, onPreview, collapsed = false, onToggle }: { project: ProjectState; update: UpdateProject; onPreview: (card: Card) => void; collapsed?: boolean; onToggle?: () => void }) {
  const [dragged, setDragged] = useState<string | null>(null), [target, setTarget] = useState<string | null>(null);
  function reorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    update(draft => {
      const from = draft.sequence.findIndex(s => s.id === fromId), to = draft.sequence.findIndex(s => s.id === toId);
      if (from < 0 || to < 0) return;
      const [shot] = draft.sequence.splice(from, 1); draft.sequence.splice(to, 0, shot);
    });
  }
  return <section className={`fo-timeline${collapsed ? ' is-collapsed' : ''}`} aria-label="成片镜头序列">
    <div className="fo-timeline-label">{onToggle ? <button type="button" className="fo-timeline-toggle" aria-label={collapsed ? '展开镜头序列' : '收起镜头序列'} aria-expanded={!collapsed} aria-controls="fo-timeline-track" onClick={onToggle}><Icon name="chevron-down" /><strong>镜头序列</strong></button> : <div><span className="fo-eyebrow">THE CUT</span><strong>我的成片</strong></div>}<span className="fo-sequence-summary">{project.sequence.length} 个镜头 · {timeLabel(project.sequence.reduce((sum, s) => sum + s.duration, 0))}</span><span className="fo-timeline-hint">拖动排序 · 调整秒数</span></div>
    <div className="fo-timeline-track" id="fo-timeline-track" hidden={collapsed}>
      {!project.sequence.length && <div className="fo-sequence-empty"><span className="fo-empty-film"><Icon name="film" /></span><span>把喜欢的镜头，放到这里。<small>选中素材，点击「加入成片」</small></span><span className="fo-sequence-arrow">↗</span></div>}
      <div className="fo-sequence-list">
        {project.sequence.map((shot, index) => {
          const card = project.cards.find(c => c.id === shot.cardId); if (!card) return null;
          const currentDuration = String(shot.duration);
          const durationOptions = durations.some(option => option.value === currentDuration)
            ? durations
            : [{ value: currentDuration, label: `${Math.round(shot.duration * 100) / 100} 秒` }, ...durations];
          return <div key={shot.id} className={`fo-seq-item${dragged === shot.id ? ' is-dragging' : ''}${target === shot.id ? ' is-drop-target' : ''}`} data-sequence-id={shot.id} draggable
            onDragStart={e => { if ((e.target as Element).closest('button,input,[role="combobox"]')) { e.preventDefault(); return; } setDragged(shot.id); e.dataTransfer.setData('text/plain', shot.id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={() => { setDragged(null); setTarget(null); }} onDragOver={e => { if (dragged) { e.preventDefault(); setTarget(shot.id); } }}
            onDragLeave={e => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setTarget(null); }}
            onDrop={e => { e.preventDefault(); if (dragged) reorder(dragged, shot.id); setDragged(null); setTarget(null); }}>
            <span className="fo-seq-number">{String(index + 1).padStart(2, '0')}</span>
            <button type="button" className="fo-seq-thumb" aria-label={`查看镜头：${card.name}`} onClick={() => onPreview(card)}><CardMedia card={card} /></button>
            <div className="fo-seq-detail"><span>{card.name}</span><div className="fo-duration-label"><Select className="fo-duration-select" value={currentDuration} onChange={value => update(draft => { const item = draft.sequence.find(s => s.id === shot.id); if (item) item.duration = Number(value); })} options={durationOptions} label={`${card.name}的播放时长`} /></div></div>
            <div className="fo-seq-actions">
              <button type="button" className="fo-tiny-button" aria-label="镜头前移" title="镜头前移" disabled={!index} onClick={() => reorder(shot.id, project.sequence[index - 1].id)}><Icon name="chevron-left" /></button>
              <button type="button" className="fo-tiny-button" aria-label="镜头后移" title="镜头后移" disabled={index === project.sequence.length - 1} onClick={() => reorder(shot.id, project.sequence[index + 1].id)}><Icon name="chevron-right" /></button>
              <button type="button" className="fo-tiny-button" aria-label="从成片移除" title="从成片移除" onClick={() => update(draft => { draft.sequence = draft.sequence.filter(s => s.id !== shot.id); })}><Icon name="x" /></button>
            </div>
          </div>;
        })}
      </div>
    </div>
  </section>;
}
