import { useEffect, useRef, useState } from 'react';
import type { Card, Provider } from '../types';
import { MAX_NOTES, MAX_REFERENCES, supportsReferences } from '../lib/consistency';
import Icon from './Icon';

export function referenceNote(provider: Provider) {
  if (provider === 'openai') return 'OpenAI 通过图片编辑接口参照这些图；gpt-image-1.5 会尽量保留人物面部特征。';
  if (provider === 'ark') return '火山方舟 Seedream 会把这些图作为多图参考。';
  return '当前服务不支持参考图，生成时只附加统一设定。';
}

/** Composer entry: what every new shot will share. */
export function ConsistencyBar({ notes, references, onOpen }: { notes: string; references: Card[]; onOpen: () => void }) {
  const summary = [notes ? '已设定' : '未设定', references.length ? `参考 ${references.length}` : ''].filter(Boolean).join(' · ');
  return <button type="button" className={`fo-consistency-bar${notes || references.length ? ' is-set' : ''}`} aria-label={`镜头一致性：${summary}`} onClick={onOpen}>
    <Icon name="copy" /><span>一致性</span><span className="fo-consistency-state">{summary}</span>
    {references.map(card => <img key={card.id} src={card.src} alt="" draggable={false} />)}
  </button>;
}

export default function ConsistencyDialog({ notes, references, provider, onSave, onRemove, onClose }: {
  notes: string; references: Card[]; provider: Provider;
  onSave: (notes: string) => void; onRemove: (id: string) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(notes);
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  // Every way out keeps what was typed.
  const close = () => { if (draft.trim() !== notes) onSave(draft.trim()); onClose(); };
  return <dialog ref={dialog} className="fo-consistency-dialog" aria-labelledby="fo-consistency-heading" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="fo-export-head"><div><span className="fo-eyebrow">CONTINUITY</span><h2 id="fo-consistency-heading">镜头一致性</h2></div><button type="button" className="fo-icon-button" aria-label="关闭镜头一致性" onClick={close}><Icon name="x" /></button></div>
    <p className="fo-consistency-intro">让同一个角色、服装和画风，在每个镜头里保持一致。对之后的生成和镜头计划生效。</p>
    <label className="fo-consistency-label" htmlFor="fo-consistency-notes">统一设定</label>
    <textarea id="fo-consistency-notes" className="fo-consistency-notes" rows={4} maxLength={MAX_NOTES} value={draft} onChange={event => setDraft(event.target.value)}
      placeholder="例如：女主角，二十岁，黑色短发，红色雨衣；雨夜城市，霓虹冷色，35mm 胶片颗粒" />
    <small className="fo-consistency-hint">附加在每次生成的提示词末尾，图片和视频都会带上。</small>
    <div className="fo-consistency-label">参考图 <span>{references.length} / {MAX_REFERENCES}</span></div>
    {references.length ? <ul className="fo-reference-list">{references.map(card => <li key={card.id}>
      <img src={card.src} alt="" draggable={false} /><span>{card.name}</span>
      <button type="button" className="fo-tiny-button" aria-label={`移除参考图：${card.name}`} onClick={() => onRemove(card.id)}><Icon name="x" /></button>
    </li>)}</ul> : <p className="fo-reference-empty">在画布上选中一张图片，点「设为参考」。</p>}
    <p className={`fo-export-note${supportsReferences(provider) ? '' : ' is-warning'}`}>{referenceNote(provider)}参考图用于生成图片；生成视频时以所选图片为首帧。</p>
    <div className="fo-export-actions"><span /><button type="button" className="fo-primary-button" onClick={close}>完成<Icon name="check" /></button></div>
  </dialog>;
}
