import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AIConfig, Provider } from '../types';
import { createClient, PROVIDERS, validateBaseUrl } from '../lib/ai-client';
import { defaults, loadProfiles, providerIds, redact, saveProfile } from '../lib/preferences';
import Select from './Select';
import Icon from './Icon';
export default function APISettings({ open, onClose, config, onChange }: { open: boolean; onClose: () => void; config: AIConfig; onChange: (config: AIConfig) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), request = useRef<AbortController | null>(null);
  const profiles = useRef(loadProfiles().profiles), previousOpen = useRef(false);
  const [draft, setDraft] = useState(config), [reveal, setReveal] = useState(false), [testing, setTesting] = useState(false);
  const [status, setStatus] = useState({ text: '', kind: '' });
  function abortTest() { request.current?.abort(); request.current = null; setTesting(false); }
  useEffect(() => {
    if (open && !previousOpen.current) { profiles.current[config.provider] = { ...config }; setDraft({ ...config }); setReveal(false); setStatus({ text: '', kind: '' }); }
    previousOpen.current = open;
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open) { request.current?.abort(); request.current = null; setTesting(false); dialog.current?.close(); }
  }, [open, config]);
  useEffect(() => () => { request.current?.abort(); }, []);
  function patch<K extends keyof AIConfig>(name: K, value: AIConfig[K]) { abortTest(); setDraft(current => ({ ...current, [name]: value })); setStatus({ text: '', kind: '' }); }
  function switchProvider(provider: Provider) { abortTest(); profiles.current[draft.provider] = { ...draft }; setDraft({ ...(profiles.current[provider] || defaults(provider)) }); setStatus({ text: '', kind: '' }); setReveal(false); }
  async function test() {
    const controller = new AbortController(); abortTest(); request.current = controller; setTesting(true); setStatus({ text: '正在验证连接与鉴权…', kind: '' });
    try { await createClient(draft).testConnection({ signal: controller.signal }); if (!controller.signal.aborted) setStatus({ text: '连接成功。具体模型权限以实际生成为准。', kind: 'success' }); }
    catch (error) { if (!controller.signal.aborted) setStatus({ text: redact(error instanceof Error ? error.message : error, draft.key), kind: 'error' }); }
    finally { if (request.current === controller) { request.current = null; setTesting(false); } }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    try {
      validateBaseUrl(draft.baseUrl);
      if (/\s/.test(draft.key)) throw new Error('API Key 不能包含空白字符');
      profiles.current[draft.provider] = { ...draft };
      for (const value of Object.values(profiles.current)) if (value) saveProfile(value);
      saveProfile(draft); onChange(draft); onClose();
    } catch (error) { setStatus({ text: redact(error instanceof Error ? error.message : error, draft.key), kind: 'error' }); }
  }
  const preset = PROVIDERS[draft.provider];
  const options = (values: readonly (string | number)[], selected: string | number) => [...new Set([...values.map(String), String(selected)])].filter(Boolean).map(value => ({ value, label: value }));
  return <dialog ref={dialog} className="fo-api-dialog" aria-labelledby="fo-api-heading" onCancel={onClose} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <form className="fo-api-form" onSubmit={save}>
      <header className="fo-api-head"><div><span className="fo-eyebrow">YOUR MODELS, YOUR IDEAS</span><h2 id="fo-api-heading">连接你的生成服务</h2><p>密钥仅保留在本页内存，刷新后需要重新填写。</p></div><button type="button" className="fo-icon-button fo-api-close" aria-label="关闭 API 设置" onClick={onClose}><Icon name="x" /></button></header>
      <div className="fo-api-body"><section className="fo-api-section"><strong className="fo-api-section-title">01 / 供应商与连接</strong>
        <div className="fo-api-field"><label>供应商</label><Select label="供应商" value={draft.provider} onChange={value => switchProvider(value as Provider)} options={providerIds.map(id => ({ value: id, label: PROVIDERS[id].label }))} /></div>
        <div className="fo-api-field"><label htmlFor="api-base">Base URL</label><input id="api-base" type="url" required readOnly={draft.provider !== 'compatible'} value={draft.baseUrl} onChange={event => patch('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" /><small>{draft.provider === 'compatible' ? '自定义接口由浏览器直连，供应商需要允许跨域。' : '通过本地 FastAPI 服务转发到供应商官方地址。'}</small></div>
        <div className="fo-api-field"><div className="fo-api-label-row"><label htmlFor="api-key">API Key</label><span className="fo-api-key-state">{draft.key ? '已填写 · 仅本页' : '未配置'}</span></div><div className="fo-api-key-row"><input id="api-key" type={reveal ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={draft.key} onChange={event => patch('key', event.target.value)} placeholder="输入你的供应商密钥" /><button type="button" className="fo-api-reveal" aria-label={reveal ? '隐藏 API Key' : '显示 API Key'} aria-pressed={reveal} onClick={() => setReveal(value => !value)}>{reveal ? '隐藏' : '显示'}</button></div></div>
      </section><section className="fo-api-section"><strong className="fo-api-section-title">02 / 模型与画面参数</strong><div className="fo-api-grid">
        <div className="fo-api-field"><label htmlFor="image-model">图片模型</label><input id="image-model" value={draft.imageModel} onChange={event => patch('imageModel', event.target.value)} /></div>
        <div className="fo-api-field"><label>图片尺寸</label><Select label="图片尺寸" value={draft.imageSize} onChange={value => patch('imageSize', value)} options={options(preset.imageSizes, draft.imageSize)} /></div>
        <div className="fo-api-field"><label htmlFor="video-model">视频模型</label><input id="video-model" disabled={!preset.canVideo} value={draft.videoModel} onChange={event => patch('videoModel', event.target.value)} /></div>
        <div className="fo-api-field"><label>视频时长（秒）</label><Select label="视频时长" disabled={!preset.canVideo} value={String(draft.duration)} onChange={value => patch('duration', Number(value))} options={options(preset.videoDurations.length ? preset.videoDurations : [5], draft.duration)} /></div>
        <div className="fo-api-field"><label>视频比例</label><Select label="视频比例" disabled={!preset.canVideo} value={draft.videoRatio} onChange={value => patch('videoRatio', value)} options={options(['16:9', '9:16', '1:1'], draft.videoRatio)} /></div>
        <div className="fo-api-field"><label>视频分辨率</label><Select label="视频分辨率" disabled={!preset.canVideo} value={draft.resolution} onChange={value => patch('resolution', value)} options={options(['720p', '1080p'], draft.resolution)} /></div>
      </div><p className="fo-api-capability-note">{draft.provider === 'openai' ? '此配置用于图片生成。生成视频请使用火山方舟或支持视频协议的兼容服务。' : preset.note}</p></section>
      <div className="fo-api-connection"><button type="button" className="fo-api-test" disabled={testing || !draft.key} onClick={() => void test()}>{testing ? '正在连接…' : '测试连接'}</button><span>只检查连接与鉴权，不发起生成。</span></div><p className="fo-api-status" role="status" data-state={status.kind}>{status.text}</p></div>
      <footer className="fo-api-footer"><button type="button" className="fo-api-clear" onClick={() => { abortTest(); profiles.current = Object.fromEntries(Object.entries(profiles.current).map(([id, value]) => [id, { ...value, key: '' }])); setDraft(value => ({ ...value, key: '' })); onChange({ ...config, key: '' }); setStatus({ text: '已清除本页所有密钥', kind: '' }); }}>清除本页所有密钥</button><button type="submit" className="fo-primary-button">保存配置 <span>↗</span></button></footer>
    </form>
  </dialog>;
}
