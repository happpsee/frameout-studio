import { useState } from 'react';
import { readStoredValue, writeStoredValue } from '../lib/desktop-storage';
import { isDesktop } from '../lib/platform';
import '../styles/browser-notice.css';

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
 */
export default function BrowserStorageNotice() {
  const [open, setOpen] = useState(() => !isDesktop() && !dismissed());
  if (!open) return null;
  return (
    <div className="fo-browser-notice" role="note" aria-label="作品保存位置">
      <p>
        作品只存在这个浏览器里。清理浏览器数据、换浏览器或用无痕窗口，作品就找不回来了；重要的图片和视频请及时下载。
      </p>
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
    </div>
  );
}
