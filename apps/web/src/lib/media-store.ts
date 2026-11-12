import { MAX_MEDIA_BYTES } from '@frameout/shared';
import { desktopBridge } from './platform';

export class DesktopMediaTooLargeError extends Error {
  constructor() {
    super('桌面版单个素材最大支持 100 MB');
  }
}

let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('frameout-media-v1', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('media'))
          request.result.createObjectStore('media', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        database = undefined;
        reject(new Error('浏览器素材存储不可用'));
      };
    });
  return database;
}
export async function putMedia(blob: Blob): Promise<string> {
  if (!/^(image|video)\//.test(blob.type)) throw new Error('素材不是图片或视频');
  const id = 'media-' + crypto.randomUUID();
  const desktop = desktopBridge();
  if (desktop) {
    if (blob.size > MAX_MEDIA_BYTES) throw new DesktopMediaTooLargeError();
    const type = new TextEncoder().encode(blob.type);
    if (type.length > 255) throw new Error('素材类型不可用');
    const data = await new Blob([Uint8Array.of(type.length), type, blob]).arrayBuffer();
    await desktop.storage.write(id, data);
    return id;
  }
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('media', 'readwrite');
    transaction.objectStore('media').put({ id, blob, createdAt: Date.now() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () =>
      reject(new Error('素材未能保存到浏览器，请及时下载'));
  });
  return id;
}
export async function getMedia(id: string): Promise<Blob | null> {
  const desktop = desktopBridge();
  if (desktop) {
    const data = await desktop.storage.read(id);
    if (!data) return null;
    if (!data.byteLength) throw new Error('本地素材文件不完整');
    const headerLength = 1 + new Uint8Array(data, 0, 1)[0];
    if (headerLength >= data.byteLength) throw new Error('本地素材文件不完整');
    const type = new TextDecoder().decode(new Uint8Array(data, 1, headerLength - 1));
    if (!/^(image|video)\//.test(type)) throw new Error('本地素材类型不可用');
    return new Blob([new Uint8Array(data, headerLength)], { type });
  }
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('media', 'readonly').objectStore('media').get(id);
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => reject(new Error('未能读取浏览器素材'));
  });
}
