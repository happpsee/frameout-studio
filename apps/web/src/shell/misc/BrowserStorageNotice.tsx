import { useId, useState } from 'react';
import { readStoredValue, writeStoredValue } from '../../core/project/desktop-storage';
import { isDesktop } from '../../platform';
import '../../styles/browser-notice.css';

export const BROWSER_NOTICE_KEY = 'frameout-browser-storage-notice-v1';

function dismissed(): boolean {
  try {
    return readStoredValue(BROWSER_NOTICE_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

/**
 * Web only: works live in this browser's storage, so say once that clearing
 * browser data or switching browsers loses them. The desktop app saves to disk.
 * One short line in the canvas label row, so it never covers the empty-canvas headline;
 * the full explanation opens on request.
 */
export default function BrowserStorageNotice() {
  const [open, setOpen] = useState(() => !isDesktop() && !dismissed());
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  if (!open) return null;
  return (
    <div className="fo-browser-notice" role="note" aria-label="作品保存位置">
      <span className="fo-browser-notice-text">作品只存在这个浏览器里</span>
      <button
        type="button"
        aria-expanded={details}
        aria-controls={detailsId}
        onClick={() => setDetails(value => !value)}
      >
        {details ? '收起' : '详情'}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          try {
            void writeStoredValue(BROWSER_NOTICE_KEY, 'dismissed')?.catch(() => {});
          } catch {
            /* Storage may be blocked; the notice just shows again next time. */
          }
        }}
      >
        知道了
      </button>
      <p id={detailsId} className="fo-browser-notice-details" hidden={!details}>
        清理浏览器数据、换浏览器或用无痕窗口，作品就找不回来了；重要的图片和视频请及时下载。
      </p>
    </div>
  );
}
