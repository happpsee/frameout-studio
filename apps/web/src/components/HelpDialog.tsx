import { Fragment, useEffect, useRef } from 'react';
import { closeOnBackdropClick } from '../lib/dialog';
import { isDesktop } from '../lib/platform';
import Icon from './Icon';

/** Each line of a shortcut description is rendered on its own row. */
const SHORTCUTS: { action: string; keys: string[] }[] = [
  { action: '平移画布', keys: ['滚轮 / 触控板滚动 · 拖动空白处', '空格 + 拖动，或鼠标中键'] },
  { action: '缩放画布', keys: ['触控板捏合 · ⌘ / Ctrl + 滚轮', '⌘ / Ctrl ＋ / −，或点击比例'] },
  { action: '触屏操作', keys: ['单指拖动 · 双指平移与缩放'] },
  { action: '查看素材', keys: ['单击选择，双击预览'] },
  { action: '撤销 / 重做', keys: ['⌘ / Ctrl Z · ⇧ ⌘ / Ctrl Z'] },
  { action: '删除素材', keys: ['选中后按 Delete / Backspace'] },
  { action: '适应画布', keys: ['按 0，或点击适应按钮'] },
];

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
  /** Desktop only: return to the product introduction. */
  onShowIntro: () => void;
}

export default function HelpDialog({ open, onClose, onShowIntro }: HelpDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const desktop = isDesktop();

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="fo-help-dialog"
      aria-labelledby="fo-help-heading"
      onCancel={onClose}
      onClose={onClose}
      onClick={closeOnBackdropClick(onClose)}
    >
      <button
        type="button"
        className="fo-icon-button fo-help-close"
        aria-label="关闭使用指南"
        onClick={onClose}
      >
        <Icon name="x" />
      </button>
      <span className="fo-eyebrow">A LITTLE GUIDE</span>
      <h2 id="fo-help-heading">
        把想法摊开，
        <br />
        再把故事连起来。
      </h2>
      <p>画布用来探索和比较。只有加入下方成片区的镜头，才会按顺序播放。</p>
      <dl>
        {SHORTCUTS.map(({ action, keys }) => (
          <div key={action}>
            <dt>{action}</dt>
            <dd>
              {keys.map((line, index) => (
                <Fragment key={line}>
                  {index > 0 && <br />}
                  {line}
                </Fragment>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <div className="fo-help-note">
        <strong>从参考图到镜头，再到你的故事。</strong>
        <span>
          生成图片和视频前，请在 API 设置中填写供应商密钥。
          {desktop
            ? '项目和本地素材自动保存到本机。供应商临时链接请及时下载。'
            : '素材保存在本浏览器或供应商临时链接，请及时下载。'}
          成片区支持顺序预览，也可以导出为 MP4（暂不含声音）。
        </span>
      </div>
      {desktop && (
        <button
          type="button"
          className="fo-help-intro"
          onClick={() => {
            onClose();
            onShowIntro();
          }}
        >
          查看产品介绍 <Icon name="arrow-up-right" />
        </button>
      )}
      <button type="button" className="fo-primary-button" onClick={onClose}>
        开始探索 <Icon name="arrow-up-right" />
      </button>
    </dialog>
  );
}
