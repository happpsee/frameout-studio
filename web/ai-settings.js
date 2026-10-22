/* FRAMEOUT · visitor-owned API preferences. Credentials stay in this page's memory. */
(function (scope, factory) {
  'use strict';
  const api = factory();
  scope.FrameoutAISettings = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';

  const STORAGE_KEY = 'frameout-ai-preferences-v1';
  const FIELDS = ['provider', 'baseUrl', 'imageModel', 'videoModel', 'imageSize', 'videoRatio', 'duration', 'resolution', 'transport'];
  const IDS = ['openai', 'ark', 'compatible'];
  const FALLBACKS = {
    openai: { label: 'OpenAI · 图片', baseUrl: 'https://api.openai.com/v1', defaultImageModel: 'gpt-image-1.5', defaultVideoModel: '', imageSizes: ['1536x1024', '1024x1024', '1024x1536'], videoDurations: [5], canVideo: false },
    ark: { label: '火山方舟 · 图片与视频', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultImageModel: '', defaultVideoModel: '', imageSizes: ['2K', '4K'], videoDurations: [5, 10], canVideo: true },
    compatible: { label: '自定义 OpenAI 兼容', baseUrl: '', defaultImageModel: '', defaultVideoModel: '', imageSizes: ['1536x1024', '1024x1024', '1024x1536'], videoDurations: [4, 8, 12], canVideo: true },
  };
  let nextId = 0;

  function preferenceOnly(value) {
    const safe = {};
    for (const name of FIELDS) {
      if (typeof value?.[name] === 'string' || typeof value?.[name] === 'number') safe[name] = value[name];
    }
    return safe;
  }

  function redact(value, key) {
    let message = String(value || '连接失败，请检查地址与密钥后重试。');
    if (key) message = message.split(String(key)).join('[密钥已隐藏]');
    return message.replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [已隐藏]').replace(/sk-[a-zA-Z0-9_-]{6,}/g, '[密钥已隐藏]').slice(0, 420);
  }

  function loadPreferences(storage) {
    try {
      const data = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
      if (!data || data.version !== 1) return { active: 'openai', profiles: {} };
      const profiles = {};
      for (const id of IDS) if (data.profiles?.[id]) profiles[id] = preferenceOnly({ ...data.profiles[id], provider: id });
      return { active: IDS.includes(data.active) ? data.active : 'openai', profiles };
    } catch (_) {
      return { active: 'openai', profiles: {} };
    }
  }

  function savePreferences(storage, active, profiles) {
    const safeProfiles = {};
    for (const id of IDS) if (profiles[id]) safeProfiles[id] = preferenceOnly({ ...profiles[id], provider: id });
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, active, profiles: safeProfiles }));
  }

  function create({ root, onChange = () => {}, onClear = () => {} } = {}) {
    if (!root?.ownerDocument) throw new Error('API 设置需要一个已挂载的画布容器');
    const document = root.ownerDocument;
    const view = document.defaultView;
    let storage;
    try { storage = view.localStorage; } catch (_) { storage = null; }
    const restored = storage ? loadPreferences(storage) : { active: 'openai', profiles: {} };
    const profiles = restored.profiles;
    const keys = new Map();
    const drafts = new Map();
    const draftKeys = new Map();
    let active = restored.active, draftProvider = active, testing = null, destroyed = false, opener = null;
    const prefix = 'fo-api-' + (++nextId);
    const provider = id => ({ ...FALLBACKS[id], ...(view.FrameoutAI?.PROVIDERS?.[id] || {}) });
    const valuesOf = list => (Array.isArray(list) ? list : []).map(item => typeof item === 'object' ? { value: String(item.value), label: String(item.label || item.value) } : { value: String(item), label: String(item) });

    function defaults(id) {
      const info = provider(id);
      const sizes = valuesOf(info.imageSizes);
      const durations = valuesOf(info.videoDurations);
      return {
        provider: id,
        baseUrl: info.baseUrl || '',
        imageModel: info.defaultImageModel || '',
        videoModel: info.defaultVideoModel || '',
        imageSize: info.defaultImageSize || sizes[0]?.value || (id === 'ark' ? '2K' : '1536x1024'),
        videoRatio: '16:9',
        duration: Number(durations[0]?.value) || 5,
        resolution: '720p',
        transport: id === 'compatible' ? 'direct' : 'proxy',
      };
    }

    function profile(id) {
      const value = { ...defaults(id), ...preferenceOnly(profiles[id]), provider: id };
      value.transport = id === 'compatible' ? 'direct' : 'proxy';
      if (id !== 'compatible') value.baseUrl = provider(id).baseUrl;
      if (id === 'compatible' && !['16:9', '9:16'].includes(value.videoRatio)) value.videoRatio = '16:9';
      return value;
    }

    const dialog = document.createElement('dialog');
    dialog.className = 'fo-api-dialog';
    dialog.setAttribute('aria-labelledby', prefix + '-title');
    dialog.setAttribute('aria-describedby', prefix + '-description');
    dialog.innerHTML = `
      <form class="fo-api-form" autocomplete="off">
        <header class="fo-api-head"><div><span class="fo-eyebrow">CONNECTED CREATION</span><h2 id="${prefix}-title">连接你的 AI。</h2><p id="${prefix}-description">配置一次，在画布里直接生成图片与视频。</p></div><button type="button" class="fo-icon-button fo-api-close" aria-label="关闭 API 设置">×</button></header>
        <div class="fo-api-body">
          <section class="fo-api-section" aria-label="连接配置"><span class="fo-api-section-title">01 / 连接</span>
            <div class="fo-api-field"><label for="${prefix}-provider">供应商</label><select id="${prefix}-provider" name="provider" class="fo-api-provider"><option value="openai">OpenAI · 图片</option><option value="ark">火山方舟 · 图片与视频</option><option value="compatible">自定义 OpenAI 兼容</option></select></div>
            <div class="fo-api-field"><label for="${prefix}-base">Base URL</label><input id="${prefix}-base" class="fo-api-base" name="baseUrl" type="url" spellcheck="false" autocomplete="off" placeholder="https://api.example.com/v1" required><small class="fo-api-route-note"></small></div>
            <div class="fo-api-field"><div class="fo-api-label-row"><label for="${prefix}-key">API Key</label><span class="fo-api-key-state"></span></div><div class="fo-api-key-row"><input id="${prefix}-key" class="fo-api-key" type="password" name="credential" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="填写此供应商的 API Key" maxlength="8192"><button type="button" class="fo-api-reveal" aria-label="显示 API Key" aria-pressed="false">显示</button></div><small>密钥仅在本页暂存，刷新后需重新填写；不会写入项目或导出文件。</small></div>
          </section>
          <section class="fo-api-section" aria-label="生成参数"><span class="fo-api-section-title">02 / 生成默认参数</span><div class="fo-api-grid">
            <div class="fo-api-field"><label for="${prefix}-image-model">图片模型</label><input id="${prefix}-image-model" class="fo-api-image-model" name="imageModel" spellcheck="false" autocomplete="off" placeholder="模型名或接入点 ID" maxlength="160" required></div>
            <div class="fo-api-field"><label for="${prefix}-image-size">图片尺寸</label><select id="${prefix}-image-size" class="fo-api-image-size" name="imageSize"></select></div>
            <div class="fo-api-field fo-api-video-field"><label for="${prefix}-video-model">视频模型</label><input id="${prefix}-video-model" class="fo-api-video-model" name="videoModel" spellcheck="false" autocomplete="off" placeholder="模型名或 ep-… 接入点 ID" maxlength="160"></div>
            <div class="fo-api-field fo-api-video-field"><label for="${prefix}-duration">视频时长</label><select id="${prefix}-duration" class="fo-api-duration" name="duration"></select></div>
            <div class="fo-api-field fo-api-video-field"><label for="${prefix}-ratio">视频比例</label><select id="${prefix}-ratio" class="fo-api-ratio" name="videoRatio"><option value="16:9">16:9 · 横屏</option><option value="9:16">9:16 · 竖屏</option><option value="1:1">1:1 · 方形</option></select></div>
            <div class="fo-api-field fo-api-video-field"><label for="${prefix}-resolution">视频分辨率</label><select id="${prefix}-resolution" class="fo-api-resolution" name="resolution"><option value="720p">720p</option><option value="1080p">1080p</option></select></div>
          </div><p class="fo-api-capability-note"></p></section>
          <div class="fo-api-connection"><button type="button" class="fo-api-test">测试连接</button><span>只验证连接与鉴权，不发起生成。</span></div>
          <p class="fo-api-status" role="status" aria-live="polite"></p>
        </div>
        <footer class="fo-api-footer"><button type="button" class="fo-api-clear">清除本页所有密钥</button><button type="submit" class="fo-primary-button fo-api-save">保存配置 <span aria-hidden="true">↗</span></button></footer>
      </form>`;
    root.append(dialog);
    const q = selector => dialog.querySelector(selector);
    const form = q('form');
    const fields = {
      baseUrl: q('.fo-api-base'), key: q('.fo-api-key'), imageModel: q('.fo-api-image-model'), videoModel: q('.fo-api-video-model'), imageSize: q('.fo-api-image-size'), videoRatio: q('.fo-api-ratio'), duration: q('.fo-api-duration'), resolution: q('.fo-api-resolution'),
    };
    const providerSelect = q('.fo-api-provider');
    const status = q('.fo-api-status');
    const testButton = q('.fo-api-test');
    const revealButton = q('.fo-api-reveal');
    const customSelects = new Map();
    if (view.FrameoutSelect) {
      for (const select of dialog.querySelectorAll('select')) {
        customSelects.set(select, view.FrameoutSelect.create(select, { host: dialog }));
      }
    }

    function setStatus(message = '', kind = '') {
      status.textContent = message;
      status.dataset.state = kind;
    }

    function abortTest() {
      if (testing) testing.abort();
      testing = null;
      testButton.disabled = false;
      testButton.textContent = '测试连接';
    }

    function resetVisibility() {
      fields.key.type = 'password';
      revealButton.textContent = '显示';
      revealButton.setAttribute('aria-label', '显示 API Key');
      revealButton.setAttribute('aria-pressed', 'false');
    }

    function fillSelect(element, values, selected) {
      element.replaceChildren();
      const options = valuesOf(values);
      if (selected && !options.some(option => option.value === String(selected))) options.push({ value: String(selected), label: String(selected) });
      for (const item of options) {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        element.append(option);
      }
      if (selected !== undefined) element.value = String(selected);
    }

    function updateKeyState() {
      q('.fo-api-key-state').textContent = fields.key.value ? '已填写 · 仅本页' : '未配置';
    }

    function readForm(id = draftProvider) {
      return {
        provider: id,
        baseUrl: id === 'compatible' ? fields.baseUrl.value.trim().replace(/\/+$/, '') : provider(id).baseUrl,
        key: fields.key.value.trim(),
        imageModel: fields.imageModel.value.trim(),
        videoModel: provider(id).canVideo ? fields.videoModel.value.trim() : '',
        imageSize: fields.imageSize.value,
        videoRatio: fields.videoRatio.value,
        duration: Number(fields.duration.value) || 5,
        resolution: fields.resolution.value,
        transport: id === 'compatible' ? 'direct' : 'proxy',
      };
    }

    function stashDraft() {
      const value = readForm();
      drafts.set(draftProvider, preferenceOnly(value));
      draftKeys.set(draftProvider, value.key);
    }

    function fillForm(id) {
      const info = provider(id);
      const value = { ...profile(id), ...(drafts.get(id) || {}) };
      providerSelect.value = id;
      fields.baseUrl.value = id === 'compatible' ? value.baseUrl : info.baseUrl;
      fields.baseUrl.readOnly = id !== 'compatible';
      fields.baseUrl.setAttribute('aria-readonly', String(id !== 'compatible'));
      fields.key.value = draftKeys.has(id) ? draftKeys.get(id) : keys.get(id) || '';
      fields.imageModel.value = value.imageModel;
      fields.videoModel.value = value.videoModel;
      fields.videoModel.disabled = !info.canVideo;
      dialog.querySelectorAll('.fo-api-video-field').forEach(field => { field.hidden = !info.canVideo; });
      fillSelect(fields.imageSize, info.imageSizes, value.imageSize);
      fillSelect(fields.duration, info.videoDurations, value.duration);
      for (const option of fields.videoRatio.options) {
        const unsupported = id === 'compatible' && option.value === '1:1';
        option.disabled = unsupported;
        option.hidden = unsupported;
      }
      fields.videoRatio.value = id === 'compatible' && value.videoRatio === '1:1' ? '16:9' : value.videoRatio;
      fields.resolution.value = value.resolution;
      for (const name of ['duration', 'videoRatio', 'resolution']) fields[name].disabled = !info.canVideo;
      q('.fo-api-route-note').textContent = id === 'compatible'
        ? '中转需要允许本网站跨域，请求直接发往此地址。'
        : '请求经站点转发到所选官方供应商。需要中转地址时请选择「自定义 OpenAI 兼容」。';
      q('.fo-api-capability-note').textContent = id === 'openai'
        ? 'OpenAI 官方 Videos API 已下线。这里接入图片生成；生成视频请选择火山方舟。'
        : id === 'ark' ? '支持 Seedream 生图与 Seedance 生视频；模型也可填写你已开通的 ep-… 接入点 ID。图生视频按首帧图片比例输出。'
          : '图片使用 Images 接口，视频使用 /videos 协议；具体模型、时长和分辨率取决于你的中转服务。';
      resetVisibility();
      updateKeyState();
      setStatus();
      customSelects.forEach(control => control.refresh());
    }

    function validBase() {
      try {
        const url = new URL(fields.baseUrl.value.trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
        fields.baseUrl.setCustomValidity('');
        return true;
      } catch (_) {
        fields.baseUrl.setCustomValidity('请填写不含账号、密码、查询参数或锚点的 HTTPS API 地址');
        fields.baseUrl.reportValidity();
        return false;
      }
    }

    function getConfig() {
      return { ...profile(active), key: keys.get(active) || '' };
    }

    function clearSecrets() {
      abortTest();
      keys.clear();
      draftKeys.clear();
      fields.key.value = '';
      resetVisibility();
      updateKeyState();
      setStatus('本页保存的所有 API Key 已清除。', 'success');
      onClear();
      onChange(getConfig());
    }

    function cleanupDraft() {
      customSelects.forEach(control => control.close());
      abortTest();
      fields.key.value = '';
      drafts.clear();
      draftKeys.clear();
      resetVisibility();
    }

    function close() {
      if (dialog.open) dialog.close();
      cleanupDraft();
    }

    function open() {
      if (destroyed || dialog.open) return;
      opener = document.activeElement;
      draftProvider = active;
      drafts.clear();
      draftKeys.clear();
      fillForm(draftProvider);
      dialog.showModal();
      const providerControl = customSelects.get(providerSelect);
      if (providerControl) providerControl.focus();
      else providerSelect.focus({ preventScroll: true });
    }

    providerSelect.addEventListener('change', () => {
      abortTest();
      stashDraft();
      draftProvider = IDS.includes(providerSelect.value) ? providerSelect.value : 'openai';
      fillForm(draftProvider);
    });
    fields.key.addEventListener('input', () => { updateKeyState(); setStatus(); });
    fields.baseUrl.addEventListener('input', () => { fields.baseUrl.setCustomValidity(''); setStatus(); });
    revealButton.addEventListener('click', () => {
      const reveal = fields.key.type === 'password';
      fields.key.type = reveal ? 'text' : 'password';
      revealButton.textContent = reveal ? '隐藏' : '显示';
      revealButton.setAttribute('aria-label', reveal ? '隐藏 API Key' : '显示 API Key');
      revealButton.setAttribute('aria-pressed', String(reveal));
    });
    q('.fo-api-close').addEventListener('click', close);
    q('.fo-api-clear').addEventListener('click', clearSecrets);
    dialog.addEventListener('cancel', cleanupDraft);
    dialog.addEventListener('close', () => {
      cleanupDraft();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
    testButton.addEventListener('click', async () => {
      if (testing || !validBase()) return;
      const config = readForm();
      if (!config.key) { setStatus('先填写此供应商的 API Key。', 'error'); fields.key.focus(); return; }
      if (!view.FrameoutAI?.createClient) { setStatus('连接模块尚未准备好，请刷新页面后重试。', 'error'); return; }
      const controller = new view.AbortController();
      testing = controller;
      testButton.disabled = true;
      testButton.textContent = '正在连接…';
      setStatus('正在验证连接与鉴权…');
      try {
        const result = await view.FrameoutAI.createClient(config).testConnection({ signal: controller.signal });
        if (testing !== controller || controller.signal.aborted) return;
        if (result?.ok === false) throw new Error(result.message || '鉴权未通过');
        setStatus('连接成功，鉴权已通过。具体模型权限以实际生成为准。', 'success');
      } catch (error) {
        if (testing !== controller || controller.signal.aborted) return;
        setStatus(redact(error?.message, config.key), 'error');
      } finally {
        if (testing === controller) { testing = null; testButton.disabled = false; testButton.textContent = '测试连接'; }
      }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!validBase() || !form.reportValidity()) return;
      stashDraft();
      for (const [id, value] of drafts) profiles[id] = preferenceOnly(value);
      for (const [id, key] of draftKeys) { if (key) keys.set(id, key); else keys.delete(id); }
      active = draftProvider;
      try { if (storage) savePreferences(storage, active, profiles); } catch (_) { /* Session preferences still work when storage is unavailable. */ }
      onChange(getConfig());
      close();
    });

    return {
      open, close, getConfig,
      hasKey: () => Boolean(keys.get(active)),
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        close();
        keys.clear();
        customSelects.forEach(control => control.destroy());
        dialog.remove();
      },
    };
  }

  return { create, preferenceOnly, loadPreferences, savePreferences, redact };
});
