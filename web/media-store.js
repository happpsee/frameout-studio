/* Generated media lives in this browser, separately from the small project JSON. */
(function () {
  'use strict';
  let database;
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('frameout-media-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('media', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = null; reject(new Error('浏览器素材存储不可用')); };
    });
    return database;
  }
  async function put(blob) {
    if (!(blob instanceof Blob) || !/^(image|video)\//.test(blob.type)) throw new Error('生成结果不是图片或视频');
    const db = await open();
    const id = 'media-' + crypto.randomUUID();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('media', 'readwrite');
      transaction.objectStore('media').put({ id, blob, createdAt: Date.now() });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(new Error('素材空间不足，请先下载生成结果'));
      transaction.onabort = () => reject(new Error('素材未能保存到浏览器'));
    });
    return id;
  }
  async function get(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('media', 'readonly').objectStore('media').get(id);
      request.onsuccess = () => resolve(request.result?.blob || null);
      request.onerror = () => reject(new Error('未能读取浏览器素材'));
    });
  }
  window.FrameoutMediaStore = { put, get };
})();
