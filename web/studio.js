/* FRAMEOUT · browser-local creative canvas prototype */
(function () {
  'use strict';

  const STORAGE_KEY = 'frameout-studio-v1';
  const ASSETS = {
    forest: 'assets/forest-astronaut.png',
    ocean: 'assets/still-ocean.webp',
    city: 'assets/still-city.webp',
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const uid = () => 'f-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const icon = (name) => typeof window.FrameoutIcons === 'function' ? window.FrameoutIcons(name) || '' : '';
  const timeLabel = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  let root, viewport, stage, sequenceList, composer, selectedActions;
  let state, activeTool = 'select', spaceHeld = false, drag = null, pendingPosition = null;
  let undoStack = [], redoStack = [], saveTimer, toastTimer, busy = false, mounted = false;
  let preview = null, previewRAF = 0, lastPreviewFrame = 0, timelineDragId = null;
  let cameraController, zoomLabel, zoomPopover, zoomInput, cardRAF = 0;
  let layout = null, selectionSize = { width: 0, height: 0 }, suppressClick = false;
  const pointers = new Map();
  const pointerCaptures = new Map();
  let pinch = null;
  let hasSavedCamera = false;
  let apiSettings, generationMode = 'image', activeGeneration = null;
  let generationModeControl;
  const timelineSelects = new Map();
  const mediaURLs = new Map();
  const missingMedia = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#252c20"/><text x="320" y="185" fill="#b5c69e" text-anchor="middle" font-family="sans-serif" font-size="22">素材暂不可用</text></svg>');
  const pendingMedia = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#252c20"/><text x="320" y="185" fill="#b5c69e" text-anchor="middle" font-family="sans-serif" font-size="22">视频生成任务</text></svg>');

  function initialState() {
    return {
      version: 1,
      title: '森林来信',
      camera: { x: 70, y: 20, zoom: 0.8 },
      selected: null,
      cards: [
        { id: 'forest-wide', x: 170, y: 165, name: '穿过森林', src: ASSETS.forest, kind: 'image', crop: '50% 50%', tone: 'normal', label: '主镜头' },
        { id: 'forest-detail', x: 480, y: 120, name: '光落下的地方', src: ASSETS.forest, kind: 'image', crop: '90% 20%', tone: 'cool', label: '画面探索' },
        { id: 'forest-moving', x: 790, y: 185, name: '向未知走去', src: ASSETS.forest, kind: 'image', crop: '32% 60%', tone: 'warm', motion: true, label: '动态预览' },
      ],
      sequence: [],
    };
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.version === 1 && Array.isArray(saved.cards) && Array.isArray(saved.sequence)) {
        const cards = saved.cards.filter((card) => card && typeof card.id === 'string' && (typeof card.src === 'string' || typeof card.mediaId === 'string') && (card.mediaId || !card.src?.startsWith('blob:')) && Number.isFinite(card.x) && Number.isFinite(card.y)).map((card) => ({ ...card, src: card.mediaId ? missingMedia : card.src, missingMedia: Boolean(card.mediaId), ...(card.job && ['submitting', 'queued', 'running'].includes(card.job.status) ? { job: { ...card.job, status: 'paused', error: card.job.id ? '页面已刷新，可继续查询此任务' : '未取得任务号，请在供应商后台确认提交状态' } } : {}) }));
        const camera = { ...initialState().camera };
        hasSavedCamera = ['x', 'y', 'zoom'].every((key) => Number.isFinite(saved.camera?.[key]));
        for (const key of ['x', 'y', 'zoom']) if (Number.isFinite(saved.camera?.[key])) camera[key] = saved.camera[key];
        camera.zoom = clamp(camera.zoom, 0.15, 4);
        return { ...initialState(), ...saved, cards, sequence: saved.sequence.filter((item) => cards.some((card) => card.id === item.cardId)).map((item) => ({ ...item, duration: clamp(Number(item.duration) || 4, 1, 15) })), camera };
      }
    } catch (_) { /* A new workspace is a valid recovery path. */ }
    return initialState();
  }

  function snapshot() {
    return clone({ cards: state.cards, sequence: state.sequence, selected: state.selected, title: state.title });
  }

  function remember(before) {
    if (!before && pointers.size) resetGesture(true);
    undoStack.push(before || snapshot());
    if (undoStack.length > 40) undoStack.shift();
    redoStack = [];
    refreshHistoryButtons();
  }

  function applySnapshot(value) {
    if (pointers.size) resetGesture(true);
    Object.assign(state, clone(value));
    renderScene();
    save();
  }

  function undo() {
    if (activeGeneration) { toast('先停止等待，再撤销；视频任务号会保留'); return; }
    if (!undoStack.length) return;
    if (pointers.size) resetGesture(true);
    redoStack.push(snapshot());
    applySnapshot(undoStack.pop());
    refreshHistoryButtons();
  }

  function redo() {
    if (activeGeneration) { toast('先停止等待，再重做；视频任务号会保留'); return; }
    if (!redoStack.length) return;
    if (pointers.size) resetGesture(true);
    undoStack.push(snapshot());
    applySnapshot(redoStack.pop());
    refreshHistoryButtons();
  }

  function refreshHistoryButtons() {
    if (!root) return;
    root.querySelector('[data-action="undo"]').disabled = undoStack.length === 0 || Boolean(activeGeneration);
    root.querySelector('[data-action="redo"]').disabled = redoStack.length === 0 || Boolean(activeGeneration);
  }

  function save() {
    clearTimeout(saveTimer);
    const label = root.querySelector('.fo-save-label');
    label.textContent = '正在保存';
    saveTimer = setTimeout(() => {
      try {
        if (cameraController) state.camera = cameraController.get();
        const saved = clone(state);
        saved.cards = saved.cards.filter((card) => !card.sessionOnly);
        saved.cards.forEach((card) => {
          if (card.mediaId) { card.src = ''; delete card.missingMedia; }
          else if (card.job && card.job.status !== 'succeeded') card.src = pendingMedia;
        });
        saved.sequence = saved.sequence.filter((item) => saved.cards.some((card) => card.id === item.cardId));
        if (!saved.cards.some((card) => card.id === saved.selected)) saved.selected = null;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        label.textContent = state.cards.some((card) => card.sessionOnly) ? '已保存 · 本地文件仅本次可用' : '已保存到此浏览器';
      } catch (_) {
        label.textContent = '保存不可用 · 请导出项目';
      }
    }, 300);
  }

  function toast(message) {
    const element = root.querySelector('.fo-toast');
    element.textContent = message;
    element.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('is-visible'), 3300);
  }

  function cameraToWorld(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    const camera = cameraController ? cameraController.get() : state.camera;
    return { x: (clientX - rect.left - camera.x) / camera.zoom, y: (clientY - rect.top - camera.y) / camera.zoom };
  }

  function refreshViewportLayout() {
    const rect = viewport.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const tools = root.querySelector('.fo-canvas-tools').getBoundingClientRect();
    layout = { width: rect.width, height: rect.height, bottom: Math.max(90, composerRect.top - rect.top - 12), tools: { right: tools.right - rect.left, bottom: tools.bottom - rect.top } };
    if (!selectedActions.hidden) selectionSize = { width: selectedActions.offsetWidth, height: selectedActions.offsetHeight };
  }

  function positionSelection(camera) {
    if (selectedActions.hidden || !layout?.width) return;
    const card = state.cards.find((item) => item.id === state.selected);
    if (!card) return;
    const left = camera.x + card.x * camera.zoom;
    const top = camera.y + card.y * camera.zoom;
    const right = left + 270 * camera.zoom;
    const bottom = top + 219 * camera.zoom;
    const outside = right < 0 || left > layout.width || bottom < 0 || top > layout.height;
    selectedActions.classList.toggle('is-outside', outside);
    selectedActions.setAttribute('aria-hidden', String(outside));
    if (outside) return;
    const { width, height } = selectionSize;
    let x = clamp((left + right - width) / 2, 12, Math.max(12, layout.width - width - 12));
    let y = top - height - 12;
    if (y < 48) y = bottom + 12;
    y = clamp(y, 48, Math.max(48, layout.bottom - height));
    if (x < layout.tools.right + 10 && y < layout.tools.bottom + 10) {
      if (layout.tools.right + 10 + width <= layout.width - 12) x = layout.tools.right + 10;
      else y = clamp(layout.tools.bottom + 10, 48, Math.max(48, layout.bottom - height));
    }
    selectedActions.style.left = x + 'px';
    selectedActions.style.top = y + 'px';
  }

  function applyCamera(camera = cameraController ? cameraController.get() : state.camera) {
    const { x, y, zoom } = camera;
    state.camera = { x, y, zoom };
    stage.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`;
    viewport.style.backgroundSize = `${26 * zoom}px ${26 * zoom}px`;
    viewport.style.backgroundPosition = `${x}px ${y}px`;
    const label = Math.round(zoom * 100) + '%';
    if (zoomLabel.textContent !== label) zoomLabel.textContent = label;
    if (document.activeElement !== zoomInput) zoomInput.value = String(Math.round(zoom * 100));
    positionSelection(camera);
  }

  function viewportPoint(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    return { x: clientX === undefined ? rect.width / 2 : clientX - rect.left, y: clientY === undefined ? Math.min(rect.height / 2, layout?.bottom || rect.height) : clientY - rect.top };
  }

  function zoomBy(factor, clientX, clientY, animate = true) {
    cameraController.zoomBy(factor, viewportPoint(clientX, clientY), { animate });
  }

  function setZoom(value) {
    if (!Number.isFinite(value) || value <= 0) return;
    cameraController.zoomTo(value / 100, viewportPoint(), { animate: true });
    closeZoom(true);
  }

  function closeZoom(returnFocus = false) {
    zoomPopover.hidden = true;
    zoomLabel.setAttribute('aria-expanded', 'false');
    if (returnFocus) zoomLabel.focus({ preventScroll: true });
  }

  function toggleZoom() {
    if (!zoomPopover.hidden) { closeZoom(true); return; }
    zoomPopover.hidden = false;
    zoomLabel.setAttribute('aria-expanded', 'true');
    zoomInput.value = String(Math.round(cameraController.getTarget().zoom * 100));
    zoomInput.focus({ preventScroll: true });
    zoomInput.select();
  }

  function fit(animate = true) {
    if (!viewport || !viewport.clientWidth) return;
    refreshViewportLayout();
    const cards = state.cards;
    let camera;
    if (!cards.length) {
      camera = { x: 60, y: 10, zoom: 0.8 };
    } else {
      const left = Math.min(...cards.map((card) => card.x));
      const top = Math.min(...cards.map((card) => card.y));
      const width = Math.max(...cards.map((card) => card.x + 270)) - left;
      const height = Math.max(...cards.map((card) => card.y + 219)) - top;
      const safeLeft = layout.width < 600 ? 68 : 95;
      const safeTop = layout.width < 600 ? 78 : 65;
      const safeRight = 24;
      const availableWidth = Math.max(100, layout.width - safeLeft - safeRight);
      const availableHeight = Math.max(100, layout.bottom - safeTop - 20);
      const zoom = clamp(Math.min(availableWidth / (width + 60), availableHeight / (height + 60)), 0.15, 1.5);
      camera = { zoom, x: safeLeft + (availableWidth - width * zoom) / 2 - left * zoom, y: safeTop + (availableHeight - height * zoom) / 2 - top * zoom };
    }
    cameraController.set(camera, { animate });
    closeZoom(!zoomPopover.hidden);
  }

  function setTool(tool) {
    activeTool = tool;
    viewport.classList.toggle('is-hand', tool === 'hand');
    root.querySelectorAll('[data-tool]').forEach((button) => {
      const selected = button.dataset.tool === tool;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function selectCard(id) {
    state.selected = id;
    stage.querySelectorAll('.fo-card').forEach((card) => card.classList.toggle('is-selected', card.dataset.id === id));
    renderSelection();
    save();
  }

  function createMedia(card, className) {
    const isVideo = card.kind === 'video' && !card.missingMedia;
    const media = document.createElement(isVideo ? 'video' : 'img');
    media.className = className || '';
    media.src = card.src;
    media.draggable = false;
    if (isVideo) {
      media.muted = true;
      media.playsInline = true;
      media.preload = 'metadata';
      if (card.poster) media.poster = card.poster;
    } else {
      media.alt = card.name;
    }
    media.style.objectPosition = card.crop || '50% 50%';
    if (card.provider) media.style.objectFit = 'contain';
    return media;
  }

  async function hydrateMedia() {
    const cards = state.cards.filter((card) => card.mediaId && card.missingMedia);
    await Promise.all(cards.map(async (card) => {
      try {
        const blob = await window.FrameoutMediaStore.get(card.mediaId);
        if (!blob || !state.cards.includes(card)) return;
        const url = URL.createObjectURL(blob);
        mediaURLs.set(card.mediaId, url);
        card.src = url;
        card.missingMedia = false;
      } catch (_) { /* Keep an honest missing-media placeholder. */ }
    }));
    if (cards.length) renderScene();
  }

  function renderScene() {
    if (pointers.size) resetGesture(true);
    const previousCards = new Set(Array.from(stage.querySelectorAll('.fo-card'), (card) => card.dataset.id));
    stage.replaceChildren();
    const group = document.createElement('div');
    group.className = 'fo-mood-group';
    group.innerHTML = '<span>森林来信 <i>/</i> MOODBOARD</span><span class="fo-group-caption">一个关于出发的小故事</span>';
    stage.append(group);

    const note = document.createElement('div');
    note.className = 'fo-canvas-note';
    note.innerHTML = '<span class="fo-note-pin"></span><span>先把想法<br>摊开。</span><small>MAKE ROOM FOR IDEAS ↗</small>';
    stage.append(note);

    for (const [index, card] of state.cards.entries()) {
      const item = document.createElement('article');
      item.className = `fo-card${state.selected === card.id ? ' is-selected' : ''}`;
      if (!previousCards.has(card.id)) {
        item.classList.add('is-entering');
        item.style.setProperty('--fo-entry-delay', `${previousCards.size ? 0 : Math.min(index, 5) * 85}ms`);
      }
      item.dataset.id = card.id;
      item.addEventListener('animationend', (event) => {
        if (event.animationName === 'fo-card-arrive') item.classList.remove('is-entering');
      });
      item.style.left = card.x + 'px';
      item.style.top = card.y + 'px';
      const header = document.createElement('div');
      header.className = 'fo-card-top';
      const kind = document.createElement('span');
      kind.innerHTML = icon(card.motion || card.kind === 'video' ? 'film' : 'image');
      kind.append(document.createTextNode(card.job && card.job.status !== 'succeeded' ? '视频任务' : card.missingMedia ? '素材需重新导入' : card.motion ? '动态预览' : card.label || (card.kind === 'video' ? '本地视频' : card.sessionOnly ? '本地图片' : '画面')));
      const detail = document.createElement('span');
      detail.textContent = card.job && card.job.status !== 'succeeded' ? videoStatus(card.job) : card.motion ? '4 SEC' : card.kind === 'video' ? `${card.duration || 4} SEC` : card.size || card.ratio || '16:9';
      header.append(kind, detail);

      const mediaButton = document.createElement('button');
      mediaButton.type = 'button';
      mediaButton.className = `fo-media tone-${card.tone || 'normal'}${card.motion ? ' is-motion' : ''}`;
      mediaButton.setAttribute('aria-label', '选择素材：' + card.name);
      mediaButton.append(createMedia(card));
      const marker = document.createElement('span');
      marker.className = 'fo-media-marker';
      marker.textContent = card.motion ? '▶' : '+';
      mediaButton.append(marker);
      if (card.job && card.job.status !== 'succeeded') {
        const status = document.createElement('span');
        status.className = 'fo-job-status';
        status.textContent = videoStatus(card.job);
        mediaButton.append(status);
      }
      mediaButton.addEventListener('click', () => selectCard(card.id));
      mediaButton.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        selectCard(card.id);
        openPreview(true);
      });
      const footer = document.createElement('div');
      footer.className = 'fo-card-bottom';
      const name = document.createElement('span');
      name.textContent = card.name;
      const label = document.createElement('span');
      label.textContent = card.provider ? card.provider.toUpperCase() : card.sessionOnly ? 'LOCAL' : 'EXPLORATION';
      footer.append(name, label);
      item.append(header, mediaButton, footer);
      stage.append(item);
    }
    const empty = root.querySelector('.fo-canvas-empty');
    empty.hidden = state.cards.length > 0;
    root.querySelector('.fo-canvas-count').textContent = `${state.cards.length} 个素材`;
    root.querySelector('.fo-project-title').textContent = state.title;
    renderSelection();
    renderSequence();
    applyCamera();
    refreshHistoryButtons();
  }

  function renderSelection() {
    const card = state.cards.find((item) => item.id === state.selected);
    root.querySelector('.fo-task-note').hidden = true;
    selectedActions.hidden = !card;
    if (!card) return;
    selectedActions.querySelector('.fo-selected-name').textContent = card.name;
    const videoButton = selectedActions.querySelector('[data-action="motion"]');
    const pending = Boolean(card.job && card.job.status !== 'succeeded');
    videoButton.disabled = busy || card.kind === 'video' || card.missingMedia || pending;
    videoButton.querySelector('span').textContent = generationMode === 'demo' ? '演示生成视频' : '生成视频';
    videoButton.title = generationMode === 'demo' ? '使用示例画面展示动态预览' : '将选中图片作为视频首帧';
    const resume = selectedActions.querySelector('[data-action="resume-video"]');
    resume.hidden = !pending;
    resume.disabled = busy;
    selectedActions.querySelector('[data-action="add"]').disabled = pending || card.missingMedia;
    const download = selectedActions.querySelector('[data-action="download-media"]');
    download.hidden = !card.provider;
    download.disabled = pending || card.missingMedia;
    const taskNote = root.querySelector('.fo-task-note');
    taskNote.hidden = !pending && !card.remoteTemporary;
    taskNote.textContent = pending ? `${videoStatus(card.job)} · ${card.job.id || '尚未取得任务号'}${card.job.error ? ' · ' + card.job.error : ''}` : card.remoteTemporary ? '供应商素材链接可能过期，请及时下载保存。' : '';
    refreshViewportLayout();
    positionSelection(cameraController ? cameraController.get() : state.camera);
  }

  function renderSequence() {
    const focusedSequence = document.activeElement?.matches('.fo-select-trigger')
      ? document.activeElement.closest('.fo-seq-item')?.dataset.sequenceId : null;
    const previousPositions = new Map(Array.from(sequenceList.children, (item) => [item.dataset.sequenceId, item.offsetLeft]));
    timelineSelects.forEach(control => control.destroy());
    timelineSelects.clear();
    sequenceList.replaceChildren();
    const total = state.sequence.reduce((sum, item) => sum + item.duration, 0);
    root.querySelector('.fo-sequence-summary').textContent = `${state.sequence.length} 个镜头 · ${timeLabel(total)}`;
    root.querySelector('[data-action="preview"]').disabled = state.sequence.length === 0;
    const empty = root.querySelector('.fo-sequence-empty');
    empty.hidden = state.sequence.length > 0;
    for (const [index, item] of state.sequence.entries()) {
      const card = state.cards.find((value) => value.id === item.cardId);
      if (!card) continue;
      const element = document.createElement('div');
      element.className = 'fo-seq-item';
      if (!previousPositions.has(item.id)) element.classList.add('is-entering');
      element.draggable = true;
      element.dataset.sequenceId = item.id;
      const number = document.createElement('span');
      number.className = 'fo-seq-number';
      number.textContent = String(index + 1).padStart(2, '0');
      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'fo-seq-thumb';
      thumb.setAttribute('aria-label', '查看镜头：' + card.name);
      thumb.append(createMedia(card));
      thumb.addEventListener('click', () => {
        selectCard(card.id);
        openPreview(true);
      });
      const details = document.createElement('div');
      details.className = 'fo-seq-detail';
      const name = document.createElement('span');
      name.textContent = card.name;
      const time = document.createElement('div');
      time.className = 'fo-duration-label';
      const duration = document.createElement('select');
      duration.setAttribute('aria-label', card.name + '的播放时长');
      for (let value = 1; value <= 15; value++) {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = value + ' 秒';
        duration.append(option);
      }
      duration.value = String(item.duration);
      duration.addEventListener('change', () => {
        remember();
        item.duration = Number(duration.value);
        renderSequence();
        save();
      });
      time.append(duration);
      details.append(name, time);
      const actions = document.createElement('div');
      actions.className = 'fo-seq-actions';
      for (const [action, label, glyph] of [['earlier', '镜头前移', 'chevron-left'], ['later', '镜头后移', 'chevron-right'], ['remove', '从成片移除', 'x']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'fo-tiny-button';
        button.setAttribute('aria-label', label);
        button.title = label;
        button.innerHTML = icon(glyph) || (action === 'remove' ? '×' : action === 'earlier' ? '‹' : '›');
        button.disabled = action === 'earlier' ? index === 0 : action === 'later' ? index === state.sequence.length - 1 : false;
        button.addEventListener('click', () => {
          remember();
          if (action === 'remove') state.sequence.splice(index, 1);
          else {
            const next = index + (action === 'earlier' ? -1 : 1);
            [state.sequence[index], state.sequence[next]] = [state.sequence[next], state.sequence[index]];
          }
          renderSequence();
          save();
        });
        actions.append(button);
      }
      element.append(number, thumb, details, actions);
      element.addEventListener('dragstart', (event) => {
        element.classList.remove('is-entering');
        timelineDragId = item.id;
        event.dataTransfer.setData('text/plain', item.id);
        event.dataTransfer.effectAllowed = 'move';
        element.classList.add('is-dragging');
      });
      element.addEventListener('dragend', () => {
        timelineDragId = null;
        element.classList.remove('is-dragging');
        sequenceList.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
      });
      element.addEventListener('dragover', (event) => {
        if (!timelineDragId) return;
        event.preventDefault();
        element.classList.add('is-drop-target');
      });
      element.addEventListener('dragleave', () => element.classList.remove('is-drop-target'));
      element.addEventListener('drop', (event) => {
        event.preventDefault();
        if (!timelineDragId || timelineDragId === item.id) return;
        const from = state.sequence.findIndex((value) => value.id === timelineDragId);
        const to = state.sequence.findIndex((value) => value.id === item.id);
        if (from < 0 || to < 0) return;
        remember();
        const moved = state.sequence.splice(from, 1)[0];
        state.sequence.splice(to, 0, moved);
        timelineDragId = null;
        renderSequence();
        save();
      });
      sequenceList.append(element);
      const durationControl = window.FrameoutSelect.create(duration, { host: root.querySelector('.fo-app'), variant: 'duration' });
      timelineSelects.set(item.id, durationControl);
    }
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const element of sequenceList.children) {
        const previous = previousPositions.get(element.dataset.sequenceId);
        const offset = previous === undefined ? 0 : previous - element.offsetLeft;
        if (offset) element.animate([{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0)' }], { duration: 340, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
    }
    if (focusedSequence) timelineSelects.get(focusedSequence)?.focus();
  }

  function addToSequence(cardId) {
    const card = state.cards.find((item) => item.id === cardId);
    if (!card || card.missingMedia || (card.job && card.job.status !== 'succeeded')) return;
    remember();
    state.sequence.push({ id: uid(), cardId, duration: card.kind === 'video' ? clamp(Number(card.duration) || 4, 1, 15) : 4 });
    renderSequence();
    save();
    toast('已加入成片 · 在下方拖动调整顺序');
  }

  function removeSelected() {
    if (!state.selected) return;
    if (activeGeneration?.cardId === state.selected) stopGeneration();
    remember();
    const id = state.selected;
    state.cards = state.cards.filter((card) => card.id !== id);
    state.sequence = state.sequence.filter((item) => item.cardId !== id);
    state.selected = null;
    renderScene();
    save();
  }

  function newCardPosition() {
    if (pendingPosition) {
      const result = pendingPosition;
      pendingPosition = null;
      return result;
    }
    const rect = viewport.getBoundingClientRect();
    return cameraToWorld(rect.left + rect.width / 2 - 110 * state.camera.zoom, rect.top + Math.max(100, rect.height / 2 - 130 * state.camera.zoom));
  }

  function updateGenerationUI(message) {
    const config = apiSettings?.getConfig();
    const provider = config && window.FrameoutAI.PROVIDERS[config.provider];
    const demo = generationMode === 'demo';
    const button = root.querySelector('[data-action="generate"]');
    button.disabled = busy;
    button.querySelector('span').textContent = busy ? '生成中' : demo ? '演示生成' : generationMode === 'video' ? '生成视频' : '生成图片';
    root.querySelector('.fo-generation-mode').value = generationMode;
    root.querySelector('.fo-generation-mode').disabled = busy;
    generationModeControl?.refresh();
    root.querySelector('.fo-demo-badge').innerHTML = '<i></i>' + (demo ? '演示模式' : '真实 API');
    root.querySelector('.fo-generation-state').textContent = message || (demo ? '内置示例素材 · 无需账号' : apiSettings?.hasKey() ? `${provider?.label || 'API'} · 按供应商计费` : '先配置 API Key，再开始生成');
    root.querySelector('[data-action="cancel-generation"]').hidden = !activeGeneration;
    renderSelection();
  }

  function setBusy(value, message) {
    busy = value;
    composer.classList.toggle('is-busy', value);
    updateGenerationUI(message);
    refreshHistoryButtons();
  }

  function generate() {
    if (busy) return;
    const input = root.querySelector('.fo-prompt');
    const text = input.value.trim();
    if (!text) {
      input.focus();
      toast('写下一点想法，例如：森林深处，一位宇航员抬头看光');
      return;
    }
    if (generationMode === 'image') { generateImage(text); return; }
    if (generationMode === 'video') { generateVideo(text); return; }
    setBusy(true);
    setTimeout(() => {
      remember();
      const position = newCardPosition();
      const tones = ['normal', 'cool', 'warm'];
      const card = { id: uid(), ...position, name: text.length > 15 ? text.slice(0, 15) + '…' : text, prompt: text, src: ASSETS.forest, kind: 'image', crop: ['50% 50%', '85% 15%', '25% 70%'][state.cards.length % 3], tone: tones[state.cards.length % 3], label: '演示图片' };
      state.cards.push(card);
      state.selected = card.id;
      input.value = '';
      setBusy(false);
      renderScene();
      save();
      toast('示例画面已加入画布 · 选中后可以演示生成视频');
    }, 1100);
  }

  function generateMotion() {
    const source = state.cards.find((card) => card.id === state.selected);
    if (!source || busy || source.kind === 'video') return;
    if (generationMode !== 'demo') {
      const input = root.querySelector('.fo-prompt');
      const prompt = input.value.trim();
      if (!prompt) { toast('先在下方写下运镜或动作描述，再生成视频'); input.focus(); return; }
      generateVideo(prompt, source);
      return;
    }
    setBusy(true);
    toast('正在准备动态预览…');
    setTimeout(() => {
      remember();
      const card = { ...clone(source), id: uid(), x: source.x + 300, y: source.y + 45, name: source.name.replace(/ · 动态$/, '') + ' · 动态', motion: true, label: '动态预览' };
      state.cards.push(card);
      state.selected = card.id;
      setBusy(false);
      renderScene();
      fit();
      save();
      toast('动态预览已准备好 · 双击画面查看');
    }, 950);
  }

  function videoStatus(job) {
    const labels = { submitting: '正在提交', queued: '排队中', running: '生成中', paused: '等待继续查询', failed: '生成失败', succeeded: '已完成' };
    return (labels[job.status] || '等待查询') + (job.status === 'running' && Number.isFinite(job.progress) ? ` ${Math.round(job.progress)}%` : '');
  }

  function requestConfig(video = false) {
    const config = apiSettings.getConfig();
    if (!config.key) { toast('在 API 设置里填写你自己的密钥'); apiSettings.open(); return null; }
    if (video && config.provider === 'openai') { toast('OpenAI 官方视频 API 已下线，请切换火山方舟或可用的兼容接口'); apiSettings.open(); return null; }
    return config;
  }

  async function storeGeneratedMedia(result) {
    if (!result.src || !/^(https:\/\/|data:(image|video)\/|blob:)/i.test(result.src)) throw new Error('接口未返回可用的图片或视频地址');
    if (/^https:/i.test(result.src)) return { src: result.src, remoteTemporary: true };
    const blob = await (await fetch(result.src)).blob();
    const src = URL.createObjectURL(blob);
    try {
      const mediaId = await window.FrameoutMediaStore.put(blob);
      mediaURLs.set(mediaId, src);
      if (result.src.startsWith('blob:')) URL.revokeObjectURL(result.src);
      return { src, mediaId, mimeType: blob.type };
    } catch (_) {
      toast('生成结果已显示，但浏览器存储不可用，请及时下载');
      return { src, sessionOnly: true, mimeType: blob.type };
    }
  }

  async function generateImage(prompt) {
    const config = requestConfig();
    if (!config) return;
    const task = { kind: 'image', controller: new AbortController() };
    activeGeneration = task;
    setBusy(true, '图片生成中，请稍候…');
    try {
      const result = await window.FrameoutAI.createClient(config).generateImage({ prompt, signal: task.controller.signal });
      if (task.controller.signal.aborted) return;
      const media = await storeGeneratedMedia(result);
      if (task.controller.signal.aborted) return;
      remember();
      const card = { id: uid(), ...newCardPosition(), ...media, name: prompt.slice(0, 18), prompt, kind: 'image', provider: result.provider, model: result.model, size: config.imageSize, requestId: result.requestId, crop: '50% 50%', tone: 'normal', label: 'AI 生成图片', generatedAt: new Date().toISOString() };
      state.cards.push(card);
      state.selected = card.id;
      root.querySelector('.fo-prompt').value = '';
      renderScene();
      save();
      toast('真实生成结果已加入画布');
    } catch (error) {
      if (error.name !== 'AbortError') toast(error.message || '图片生成失败，请检查 API 配置');
    } finally {
      if (activeGeneration === task) { activeGeneration = null; setBusy(false); }
    }
  }

  async function referenceForAPI(card, signal) {
    if (!card) return undefined;
    if (card.missingMedia) throw new Error('首帧素材已不可用，请重新导入');
    if (card.src.startsWith('https://')) return card.src;
    const response = await fetch(card.src, { signal, credentials: 'omit' });
    if (!response.ok) throw new Error('无法读取首帧素材');
    const blob = await response.blob();
    if (!/^image\//.test(blob.type)) throw new Error('首帧必须是图片');
    if (blob.size > 10 * 1024 * 1024) throw new Error('首帧图片请控制在 10MB 以内');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('首帧图片读取失败'));
      reader.readAsDataURL(blob);
    });
  }

  function jobConfig(config) {
    const value = {};
    for (const key of ['provider', 'baseUrl', 'imageModel', 'videoModel', 'imageSize', 'videoRatio', 'duration', 'resolution', 'transport']) value[key] = config[key];
    return value;
  }

  function updateJob(card, patch) {
    if (!state.cards.includes(card)) return;
    Object.assign(card.job, patch);
    const element = stage.querySelector(`.fo-card[data-id="${card.id}"]`);
    if (element) {
      const status = videoStatus(card.job);
      element.querySelector('.fo-card-top>span:last-child').textContent = status;
      const badge = element.querySelector('.fo-job-status');
      if (badge) badge.textContent = status;
    }
    if (state.selected === card.id) renderSelection();
    save();
  }

  function abortableDelay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('已停止等待', 'AbortError')); return; }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      function abort() { clearTimeout(timer); reject(new DOMException('已停止等待', 'AbortError')); }
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  async function pollVideo(card, client, task, first) {
    const started = Date.now();
    let result = first;
    while (!task.controller.signal.aborted && state.cards.includes(card)) {
      if (!result) result = await client.getVideo({ id: card.job.id, signal: task.controller.signal });
      if (result.status === 'succeeded' && !result.src) result = await client.getVideo({ id: card.job.id, signal: task.controller.signal });
      if (result.status === 'succeeded') {
        const media = await storeGeneratedMedia(result);
        if (task.controller.signal.aborted || !state.cards.includes(card)) return;
        remember();
        Object.assign(card, media, { kind: 'video', label: 'AI 生成视频', duration: Number(card.job.config.duration) || 5, generatedAt: new Date().toISOString() });
        card.job.status = 'succeeded';
        delete card.job.error;
        renderScene();
        save();
        toast('真实视频已加入画布 · 双击播放');
        return;
      }
      if (result.status === 'failed') {
        updateJob(card, { status: 'failed', error: result.error || '供应商返回生成失败' });
        throw new Error(card.job.error);
      }
      updateJob(card, { status: result.status, progress: result.progress, error: '' });
      updateGenerationUI(`${videoStatus(card.job)} · 你可以停止等待，稍后继续查询`);
      if (Date.now() - started > 15 * 60 * 1000) {
        updateJob(card, { status: 'paused', error: '等待时间较长，可稍后继续查询同一任务' });
        return;
      }
      await abortableDelay(Date.now() - started > 60000 ? 7000 : 3000, task.controller.signal);
      result = null;
    }
  }

  async function generateVideo(prompt, source) {
    const config = requestConfig(true);
    if (!config) return;
    const task = { kind: 'video', controller: new AbortController() };
    activeGeneration = task;
    setBusy(true, '正在提交视频任务…');
    let card;
    try {
      const client = window.FrameoutAI.createClient(config);
      const reference = await referenceForAPI(source, task.controller.signal);
      if (task.controller.signal.aborted) return;
      remember();
      card = { id: uid(), ...(source ? { x: source.x + 300, y: source.y + 30 } : newCardPosition()), name: prompt.slice(0, 18) + ' · 视频', prompt, src: source?.src || pendingMedia, kind: 'image', provider: config.provider, model: config.videoModel, tone: 'normal', label: '视频任务', job: { status: 'submitting', config: jobConfig(config), createdAt: Date.now() } };
      task.cardId = card.id;
      state.cards.push(card);
      state.selected = card.id;
      renderScene(); save();
      const result = await client.submitVideo({ prompt, reference, signal: task.controller.signal });
      if (!result.id) throw new Error('接口未返回任务号，请先在供应商后台确认是否已提交');
      updateJob(card, { id: result.id, status: result.status || 'queued' });
      if (task.controller.signal.aborted) { updateJob(card, { status: 'paused' }); return; }
      root.querySelector('.fo-prompt').value = '';
      await pollVideo(card, client, task, result);
    } catch (error) {
      if (card && card.job.status !== 'failed' && state.cards.includes(card)) updateJob(card, { status: 'paused', error: error.name === 'AbortError' ? '已停止本页等待' : error.message });
      if (error.name !== 'AbortError') toast(error.message || '视频任务失败');
    } finally {
      if (activeGeneration === task) { activeGeneration = null; setBusy(false); }
    }
  }

  async function resumeVideo() {
    if (busy) return;
    const card = state.cards.find((item) => item.id === state.selected);
    if (!card?.job) return;
    if (!card.job.id) { toast('没有取得任务号，请先在供应商后台确认提交状态，避免重复扣费'); return; }
    const current = requestConfig(true);
    if (!current) return;
    const config = card.job.config;
    if (current.provider !== config.provider || current.baseUrl.replace(/\/$/, '') !== config.baseUrl.replace(/\/$/, '')) {
      toast('请在设置中切回该任务原来的供应商与 API 地址'); apiSettings.open(); return;
    }
    const task = { kind: 'video', cardId: card.id, controller: new AbortController() };
    activeGeneration = task;
    setBusy(true, '正在查询已有视频任务…');
    try { await pollVideo(card, window.FrameoutAI.createClient({ ...config, key: current.key }), task); }
    catch (error) {
      if (card.job.status !== 'failed') updateJob(card, { status: 'paused', error: error.name === 'AbortError' ? '已停止本页等待' : error.message });
      if (error.name !== 'AbortError') toast(error.message || '任务查询失败');
    } finally { if (activeGeneration === task) { activeGeneration = null; setBusy(false); } }
  }

  function stopGeneration() {
    if (!activeGeneration) return;
    const task = activeGeneration;
    task.controller.abort();
    activeGeneration = null;
    setBusy(false);
    toast(task.kind === 'video' ? '已停止本页等待；已提交任务仍可能在供应商运行' : '已停止等待；已提交的生成请求仍可能计费');
  }

  function downloadMedia() {
    const card = state.cards.find((item) => item.id === state.selected);
    if (!card || card.missingMedia || (card.job && card.job.status !== 'succeeded')) return;
    const link = document.createElement('a');
    link.href = card.src;
    const extension = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/webm': 'webm' }[card.mimeType] || (card.kind === 'video' ? 'mp4' : 'png');
    link.download = `frameout-${card.id}.${extension}`;
    if (card.remoteTemporary) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    link.click();
  }

  function importFiles(files) {
    const accepted = Array.from(files).filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'));
    if (!accepted.length) {
      toast('请选择图片或视频文件');
      return;
    }
    remember();
    const position = newCardPosition();
    accepted.forEach((file, index) => {
      const card = { id: uid(), x: position.x + index * 34, y: position.y + index * 36, name: file.name.replace(/\.[^.]+$/, ''), src: URL.createObjectURL(file), kind: file.type.startsWith('video/') ? 'video' : 'image', crop: '50% 50%', tone: 'normal', sessionOnly: true, label: '本地素材' };
      state.cards.push(card);
      state.selected = card.id;
    });
    renderScene();
    fit();
    save();
    toast(`已添加 ${accepted.length} 个本地素材 · 文件仅在本次页面会话中可用`);
  }

  function exportProject() {
    const project = { ...clone(state), exportedAt: new Date().toISOString(), format: 'FRAMEOUT project', notice: '这是项目 JSON，不是视频文件。生成素材保存在本浏览器或供应商临时链接，请另行下载媒体文件。本文件不含 API Key。' };
    project.cards = project.cards.map((card) => {
      const value = { ...card };
      if (value.sessionOnly || value.mediaId || value.src?.startsWith('blob:')) { value.src = ''; value.relinkRequired = true; }
      return value;
    });
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'frameout-project.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出项目 JSON');
  }

  function stopPreview() {
    cancelAnimationFrame(previewRAF);
    previewRAF = 0;
    preview = null;
    const video = root.querySelector('.fo-preview-screen video');
    if (video) video.pause();
  }

  function closePreview() {
    stopPreview();
    const dialog = root.querySelector('.fo-preview-dialog');
    if (dialog.open) dialog.close();
  }

  function previewPosition() {
    if (!preview) return { index: 0, offset: 0 };
    let offset = 0;
    for (let index = 0; index < preview.items.length; index++) {
      if (preview.time < offset + preview.items[index].duration || index === preview.items.length - 1) return { index, offset };
      offset += preview.items[index].duration;
    }
    return { index: 0, offset: 0 };
  }

  function updatePreviewMedia(force) {
    if (!preview) return;
    const { index, offset } = previewPosition();
    if (force || preview.index !== index) {
      preview.index = index;
      const card = preview.items[index].card;
      const screen = root.querySelector('.fo-preview-screen');
      const oldVideo = screen.querySelector('video');
      if (oldVideo) oldVideo.pause();
      screen.replaceChildren();
      screen.className = `fo-preview-screen tone-${card.tone || 'normal'}${card.motion ? ' is-motion' : ''}`;
      const media = createMedia(card);
      screen.append(media);
      if (card.kind === 'video') {
        media.addEventListener('loadedmetadata', () => {
          if (!preview) return;
          media.currentTime = clamp(preview.time - offset, 0, Math.max(0, media.duration || 0));
          if (preview.playing) media.play().catch(() => {});
        }, { once: true });
      }
      root.querySelector('.fo-preview-shot').textContent = `${String(index + 1).padStart(2, '0')} / ${String(preview.items.length).padStart(2, '0')} · ${card.name}`;
    }
    const slider = root.querySelector('.fo-preview-progress');
    slider.value = String(preview.time);
    slider.style.setProperty('--progress', (preview.time / preview.total * 100) + '%');
    root.querySelector('.fo-preview-time').textContent = `${timeLabel(preview.time)} / ${timeLabel(preview.total)}`;
    const playButton = root.querySelector('[data-action="toggle-preview"]');
    playButton.innerHTML = icon(preview.playing ? 'pause' : 'play') || (preview.playing ? 'Ⅱ' : '▶');
    playButton.setAttribute('aria-label', preview.playing ? '暂停预览' : '播放预览');
    root.querySelector('.fo-preview-screen').classList.toggle('is-paused', !preview.playing);
  }

  function previewTick(timestamp) {
    if (!preview) return;
    if (preview.playing && lastPreviewFrame) {
      preview.time = Math.min(preview.total, preview.time + Math.min(0.1, (timestamp - lastPreviewFrame) / 1000));
      if (preview.time >= preview.total) preview.playing = false;
      updatePreviewMedia();
    }
    lastPreviewFrame = timestamp;
    previewRAF = requestAnimationFrame(previewTick);
  }

  function openPreview(single) {
    const selected = state.cards.find((card) => card.id === state.selected);
    if (single && selected && (selected.missingMedia || (selected.job && selected.job.status !== 'succeeded'))) { toast('该素材尚未生成完成或需要重新导入'); return; }
    const items = single && selected ? [{ card: selected, duration: selected.kind === 'video' ? clamp(Number(selected.duration) || 4, 1, 15) : 4 }] : state.sequence.map((item) => ({ card: state.cards.find((card) => card.id === item.cardId), duration: item.duration })).filter((item) => item.card);
    if (!items.length) {
      toast('先选择素材并加入成片，再开始预览');
      return;
    }
    stopPreview();
    preview = { items, total: items.reduce((sum, item) => sum + item.duration, 0), time: 0, index: -1, playing: true };
    root.querySelector('.fo-preview-title').textContent = single ? selected.name : state.title;
    const slider = root.querySelector('.fo-preview-progress');
    slider.max = String(preview.total);
    root.querySelector('.fo-preview-dialog').showModal();
    updatePreviewMedia(true);
    lastPreviewFrame = 0;
    previewRAF = requestAnimationFrame(previewTick);
  }

  function togglePreview() {
    if (!preview) return;
    if (preview.time >= preview.total) preview.time = 0;
    preview.playing = !preview.playing;
    const video = root.querySelector('.fo-preview-screen video');
    if (video) {
      if (preview.playing) video.play().catch(() => {});
      else video.pause();
    }
    updatePreviewMedia();
  }

  function skipPreview(direction) {
    if (!preview) return;
    const target = clamp(previewPosition().index + direction, 0, preview.items.length - 1);
    preview.time = preview.items.slice(0, target).reduce((sum, item) => sum + item.duration, 0);
    updatePreviewMedia(true);
  }

  function handleAction(action) {
    switch (action) {
      case 'home': closePreview(); if (typeof window.closeStudio === 'function') window.closeStudio(); break;
      case 'help': root.querySelector('.fo-help-dialog').showModal(); break;
      case 'api-settings': apiSettings.open(); break;
      case 'cancel-generation': stopGeneration(); break;
      case 'resume-video': resumeVideo(); break;
      case 'download-media': downloadMedia(); break;
      case 'close-help': root.querySelector('.fo-help-dialog').close(); break;
      case 'upload': root.querySelector('.fo-file-input').click(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'zoom-in': zoomBy(1.2); break;
      case 'zoom-out': zoomBy(1 / 1.2); break;
      case 'zoom-options': toggleZoom(); break;
      case 'fit': fit(); break;
      case 'generate': generate(); break;
      case 'motion': generateMotion(); break;
      case 'add': addToSequence(state.selected); break;
      case 'delete': removeSelected(); break;
      case 'preview': openPreview(false); break;
      case 'export': exportProject(); break;
      case 'close-preview': closePreview(); break;
      case 'toggle-preview': togglePreview(); break;
      case 'prev-preview': skipPreview(-1); break;
      case 'next-preview': skipPreview(1); break;
    }
  }

  function isTyping(target) {
    return target instanceof Element && Boolean(target.closest('input,textarea,select,[role="combobox"],.fo-select-menu,[contenteditable="true"]'));
  }

  function renderCardPosition() {
    cardRAF = 0;
    if (drag?.kind !== 'card') return;
    const card = state.cards.find((item) => item.id === drag.id);
    if (!card) return;
    drag.element.style.transform = `translate3d(${card.x - drag.x}px, ${card.y - drag.y}px, 0)`;
    positionSelection(cameraController.get());
  }

  function finishDrag(cancelled = false, dropY) {
    if (!drag) return;
    if (cardRAF) cancelAnimationFrame(cardRAF);
    cardRAF = 0;
    if (drag.kind === 'card') {
      const card = state.cards.find((item) => item.id === drag.id);
      if (card) {
        if (cancelled) { card.x = drag.x; card.y = drag.y; }
        else if (drag.moved) remember(drag.before);
        drag.element.style.left = card.x + 'px';
        drag.element.style.top = card.y + 'px';
        drag.element.style.transform = '';
      }
      drag.element.classList.remove('is-dragging');
      const timeline = root.querySelector('.fo-timeline').getBoundingClientRect();
      if (!cancelled && drag.moved && dropY >= timeline.top && dropY <= timeline.bottom) addToSequence(drag.id);
    }
    if (drag.moved) suppressClick = performance.now() + 300;
    viewport.classList.remove('is-panning');
    drag = null;
    positionSelection(cameraController.get());
    save();
  }

  function resetGesture(cancelled = true) {
    finishDrag(cancelled);
    pinch = null;
    const ids = Array.from(pointers.keys());
    pointers.clear();
    for (const id of ids) {
      const element = pointerCaptures.get(id);
      if (element?.hasPointerCapture(id)) element.releasePointerCapture(id);
    }
    pointerCaptures.clear();
    viewport.classList.remove('is-panning');
    cameraController.cancel();
    cameraController.flush();
    save();
  }

  function beginPinch() {
    finishDrag(false);
    cameraController.cancel();
    const [a, b] = Array.from(pointers.values());
    const point = viewportPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
    const camera = cameraController.get();
    pinch = { distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), zoom: camera.zoom, world: { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom } };
    suppressClick = performance.now() + 300;
    viewport.classList.add('is-panning');
  }

  function connectEvents() {
    composer.addEventListener('submit', (event) => event.preventDefault());
    root.querySelector('.fo-generation-mode').addEventListener('change', (event) => {
      generationMode = event.target.value;
      try { localStorage.setItem('frameout-generation-mode', generationMode); } catch (_) { /* Session mode still works. */ }
      updateGenerationUI();
    });
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (button && !button.disabled) handleAction(button.dataset.action);
      const preset = event.target.closest('[data-zoom]');
      if (preset) setZoom(Number(preset.dataset.zoom));
      const tool = event.target.closest('[data-tool]');
      if (tool) setTool(tool.dataset.tool);
    });
    viewport.addEventListener('click', (event) => {
      if (event.detail && performance.now() < suppressClick && !event.target.closest('.fo-composer, .fo-selection-actions, .fo-canvas-tools, .fo-camera-tools')) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    }, true);
    document.addEventListener('pointerdown', (event) => {
      if (!zoomPopover.hidden && !event.target.closest('.fo-camera-tools')) closeZoom();
    });
    root.querySelector('.fo-zoom-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = Number(zoomInput.value.trim().replace(/%$/, ''));
      if (!Number.isFinite(value) || value <= 0) {
        zoomInput.setCustomValidity('请输入 15 到 400 之间的比例');
        zoomInput.reportValidity();
        return;
      }
      zoomInput.setCustomValidity('');
      setZoom(clamp(value, 15, 400));
      zoomLabel.focus({ preventScroll: true });
    });
    zoomInput.addEventListener('input', () => zoomInput.setCustomValidity(''));
    zoomPopover.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeZoom(true); }
    });
    zoomPopover.addEventListener('focusout', (event) => {
      if (event.relatedTarget && !zoomPopover.contains(event.relatedTarget) && event.relatedTarget !== zoomLabel) closeZoom();
    });
    root.querySelector('.fo-file-input').addEventListener('change', (event) => {
      importFiles(event.target.files);
      event.target.value = '';
    });
    root.querySelector('.fo-prompt').addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        generate();
      }
    });
    viewport.addEventListener('wheel', (event) => {
      if (event.target.closest('.fo-composer, .fo-selection-actions, .fo-canvas-tools, .fo-camera-tools')) return;
      event.preventDefault();
      if (pointers.size) return;
      const { dx, dy } = window.FrameoutCamera.normalizeWheel(event, viewport.clientHeight);
      if (event.ctrlKey || event.metaKey) zoomBy(Math.exp(-dy * 0.002), event.clientX, event.clientY, false);
      else cameraController.pan(-(event.shiftKey && !dx ? dy : dx), event.shiftKey && !dx ? 0 : -dy);
    }, { passive: false });
    viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.button !== 1) return;
      if (event.target.closest('.fo-composer, .fo-selection-actions, .fo-canvas-tools, .fo-camera-tools, .fo-canvas-intro')) return;
      closeZoom();
      cameraController.cancel();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
      const captureElement = event.target instanceof Element ? event.target : viewport;
      captureElement.setPointerCapture(event.pointerId);
      pointerCaptures.set(event.pointerId, captureElement);
      event.preventDefault();
      if (pointers.size >= 2) { beginPinch(); return; }
      const cardElement = event.target.closest('.fo-card');
      const card = cardElement && state.cards.find((item) => item.id === cardElement.dataset.id);
      const hand = spaceHeld || activeTool === 'hand' || event.button === 1;
      if (card && !hand) {
        selectCard(card.id);
        drag = { kind: 'card', pointerId: event.pointerId, id: card.id, element: cardElement, startX: event.clientX, startY: event.clientY, x: card.x, y: card.y, before: snapshot(), moved: false };
        cardElement.classList.remove('is-entering');
        cardElement.classList.add('is-dragging');
      } else {
        if (!hand) selectCard(null);
        const camera = cameraController.get();
        drag = { kind: 'camera', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: camera.x, y: camera.y, moved: false };
        viewport.classList.add('is-panning');
      }
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
      if (pinch && pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const point = viewportPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
        const zoom = clamp(pinch.zoom * Math.hypot(b.x - a.x, b.y - a.y) / pinch.distance, 0.15, 4);
        cameraController.set({ zoom, x: point.x - pinch.world.x * zoom, y: point.y - pinch.world.y * zoom });
        return;
      }
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.kind === 'camera') {
        cameraController.set({ ...cameraController.get(), x: drag.x + dx, y: drag.y + dy });
      } else {
        const card = state.cards.find((item) => item.id === drag.id);
        if (!card) return;
        const zoom = cameraController.get().zoom;
        card.x = drag.x + dx / zoom;
        card.y = drag.y + dy / zoom;
        if (!cardRAF) cardRAF = requestAnimationFrame(renderCardPosition);
      }
    });
    function endPointer(event) {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      const captureElement = pointerCaptures.get(event.pointerId);
      pointerCaptures.delete(event.pointerId);
      if (captureElement?.hasPointerCapture(event.pointerId)) captureElement.releasePointerCapture(event.pointerId);
      const cancelled = event.type !== 'pointerup';
      if (pinch) {
        pinch = null;
        suppressClick = performance.now() + 300;
        if (pointers.size >= 2) beginPinch();
        else if (pointers.size === 1) {
          const [id, point] = pointers.entries().next().value;
          const camera = cameraController.get();
          drag = { kind: 'camera', pointerId: id, startX: point.x, startY: point.y, x: camera.x, y: camera.y, moved: false };
        } else viewport.classList.remove('is-panning');
      } else if (drag?.pointerId === event.pointerId) {
        finishDrag(cancelled, cancelled ? undefined : event.clientY);
      }
      cameraController.flush();
    }
    viewport.addEventListener('pointerup', endPointer);
    viewport.addEventListener('pointercancel', endPointer);
    viewport.addEventListener('lostpointercapture', endPointer);
    viewport.addEventListener('dblclick', (event) => {
      if (performance.now() < suppressClick) return;
      if (event.target.closest('.fo-card,.fo-composer,.fo-selection-actions,.fo-canvas-tools,.fo-camera-tools,.fo-canvas-intro')) return;
      pendingPosition = cameraToWorld(event.clientX, event.clientY);
      root.querySelector('.fo-prompt').focus();
    });
    viewport.addEventListener('dragover', (event) => {
      if (event.dataTransfer.types.includes('Files')) {
        event.preventDefault();
        viewport.classList.add('is-file-drop');
      }
    });
    viewport.addEventListener('dragleave', (event) => {
      if (!viewport.contains(event.relatedTarget)) viewport.classList.remove('is-file-drop');
    });
    viewport.addEventListener('drop', (event) => {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      viewport.classList.remove('is-file-drop');
      pendingPosition = cameraToWorld(event.clientX, event.clientY);
      importFiles(event.dataTransfer.files);
    });
    document.addEventListener('keydown', (event) => {
      if (!root || root.hidden || root.getAttribute('aria-hidden') === 'true' || getComputedStyle(root).display === 'none' || isTyping(event.target)) return;
      if (root.querySelector('dialog[open]')) return;
      if (pointers.size) {
        if (event.key === 'Escape') { event.preventDefault(); resetGesture(true); }
        return;
      }
      if (event.code === 'Space') {
        spaceHeld = true;
        viewport.classList.add('is-hand');
        event.preventDefault();
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === '+' || event.key === '=' || event.key === '-')) {
        event.preventDefault(); zoomBy(event.key === '-' ? 1 / 1.2 : 1.2);
      } else if (event.key === '0') {
        event.preventDefault(); fit();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (state.selected) { event.preventDefault(); removeSelected(); }
      } else if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'v') setTool('select');
      else if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'h') setTool('hand');
      else if (event.key === 'Escape') {
        if (!zoomPopover.hidden) closeZoom(true);
        else selectCard(null);
      }
    });
    document.addEventListener('keyup', (event) => {
      if (event.code === 'Space') {
        spaceHeld = false;
        if (viewport) viewport.classList.toggle('is-hand', activeTool === 'hand');
      }
    });
    window.addEventListener('blur', () => {
      spaceHeld = false;
      resetGesture(true);
      viewport.classList.toggle('is-hand', activeTool === 'hand');
    });
    root.querySelector('.fo-preview-dialog').addEventListener('cancel', stopPreview);
    root.querySelector('.fo-preview-dialog').addEventListener('close', stopPreview);
    root.querySelector('.fo-preview-progress').addEventListener('input', (event) => {
      if (!preview) return;
      preview.time = Number(event.target.value);
      updatePreviewMedia(true);
    });
    root.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      }
    }));
  }

  function mount(container) {
    if (mounted) return;
    root = container;
    if (!root) return;
    mounted = true;
    state = restore();
    root.classList.add('fo-studio');
    root.innerHTML = `
      <div class="fo-app">
        <header class="fo-header">
          <button type="button" class="fo-brand" data-action="home" aria-label="返回 FRAMEOUT 首页"><span class="fo-brand-mark">F<span>↗</span></span><span>FRAMEOUT<span class="fo-brand-zh">帧外</span></span></button>
          <div class="fo-project"><span class="fo-project-divider">/</span><div><span class="fo-project-title">森林来信</span><span class="fo-save"><i></i><span class="fo-save-label">已保存到此浏览器</span></span></div></div>
          <nav class="fo-workspace-tabs" aria-label="工作区"><button type="button" class="is-active">画布</button><button type="button" data-action="help">使用指南 ${icon('arrow-up-right')}</button></nav>
          <div class="fo-header-actions"><button type="button" class="fo-text-button fo-api-button" data-action="api-settings" aria-label="API 设置">${icon('settings')}<span>API 设置</span></button><button type="button" class="fo-text-button fo-export-button" data-action="export" aria-label="导出项目">${icon('download')}<span>导出项目</span></button><button type="button" class="fo-primary-button" data-action="preview">${icon('play')}<span>预览成片</span></button></div>
        </header>
        <main class="fo-viewport" aria-label="无限创作画布">
          <div class="fo-canvas-intro"><span class="fo-eyebrow">YOUR CREATIVE SPACE</span><span class="fo-canvas-count">3 个素材</span></div>
          <div class="fo-stage"></div>
          <div class="fo-canvas-empty" hidden><span>MAKE A SCENE.</span><p>从一句想法，或一张图片开始。</p><button type="button" class="fo-primary-button" data-action="upload">添加素材 ${icon('plus')}</button></div>
          <aside class="fo-canvas-tools" aria-label="画布工具">
            <button type="button" data-tool="select" class="fo-icon-button is-active" title="选择素材 · V" aria-label="选择工具" aria-pressed="true">${icon('cursor') || '↖'}</button>
            <button type="button" data-tool="hand" class="fo-icon-button" title="移动画布 · H / 空格" aria-label="移动画布工具" aria-pressed="false">${icon('hand') || '✋'}</button>
            <span class="fo-tool-divider"></span>
            <button type="button" data-action="upload" class="fo-icon-button" title="添加本地图片或视频" aria-label="添加本地素材">${icon('upload') || '+'}</button>
            <button type="button" data-action="undo" class="fo-icon-button" title="撤销 · ⌘ / Ctrl Z" aria-label="撤销">${icon('undo') || '↶'}</button>
            <button type="button" data-action="redo" class="fo-icon-button" title="重做 · ⇧ ⌘ Z" aria-label="重做">${icon('redo') || '↷'}</button>
            <span class="fo-tool-divider"></span>
            <button type="button" data-action="help" class="fo-icon-button" title="使用指南" aria-label="打开使用指南">${icon('help') || '?'}</button>
          </aside>
          <div class="fo-selection-actions" hidden><span class="fo-selected-name"></span><button type="button" class="fo-small-button" data-action="motion">${icon('film')}<span>生成视频</span></button><button type="button" class="fo-small-button" data-action="resume-video" hidden>${icon('clock')}<span>继续查询</span></button><button type="button" class="fo-small-button fo-add-shot" data-action="add">${icon('plus')}<span>加入成片</span></button><button type="button" class="fo-icon-button" data-action="download-media" aria-label="下载生成素材" title="下载素材，供应商临时链接将在新标签页打开" hidden>${icon('download')}</button><button type="button" class="fo-icon-button" data-action="delete" aria-label="删除选中素材" title="删除素材">${icon('trash') || '×'}</button></div>
          <form class="fo-composer">
            <div class="fo-composer-top"><label for="fo-prompt">让想法，先有一个画面。</label><select class="fo-generation-mode" aria-label="生成模式"><option value="image">真实图片</option><option value="video">真实视频</option><option value="demo">演示素材</option></select><span class="fo-demo-badge"><i></i>真实 API</span></div>
            <textarea class="fo-prompt" id="fo-prompt" rows="2" placeholder="森林深处，一位宇航员抬头看光…" maxlength="4000"></textarea>
            <p class="fo-task-note" role="status" hidden></p>
            <div class="fo-composer-bottom"><span class="fo-generation-state">先配置 API Key，再开始生成</span><button type="button" class="fo-cancel-generation" data-action="cancel-generation" hidden>停止等待</button><button type="button" class="fo-generate-button" data-action="generate">${icon('sparkles')}<span>生成图片</span>${icon('arrow-up-right')}</button></div>
            <div class="fo-generation-line"></div>
          </form>
          <div class="fo-camera-tools" aria-label="缩放控制"><button type="button" class="fo-icon-button" data-action="zoom-out" aria-label="缩小">${icon('minus') || '−'}</button><button type="button" class="fo-zoom-label" data-action="zoom-options" aria-expanded="false" aria-controls="fo-zoom-popover" aria-haspopup="dialog" aria-label="缩放比例选项">80%</button><button type="button" class="fo-icon-button" data-action="zoom-in" aria-label="放大">${icon('plus') || '+'}</button><span class="fo-tool-divider"></span><button type="button" class="fo-icon-button" data-action="fit" aria-label="适应全部素材" title="适应全部素材 · ⌘ / Ctrl 0">${icon('maximize') || '⛶'}</button><div class="fo-zoom-popover" id="fo-zoom-popover" role="dialog" aria-label="画布缩放" hidden><form class="fo-zoom-form"><label for="fo-zoom-input">缩放比例</label><div><input class="fo-zoom-input" id="fo-zoom-input" type="text" inputmode="decimal" autocomplete="off" aria-label="缩放比例"><span>%</span><button type="submit">应用</button></div></form><div class="fo-zoom-presets"><button type="button" data-zoom="50">50%</button><button type="button" data-zoom="100">100%</button><button type="button" data-zoom="200">200%</button></div><button type="button" class="fo-zoom-fit" data-action="fit">适应全部素材<span>⌘ / Ctrl 0</span></button></div></div>
          <div class="fo-canvas-hint"><span>滚动平移</span><i>·</i><span>⌘ / Ctrl + 滚轮缩放</span><i>·</i><span>空格拖动画布</span></div>
          <div class="fo-file-drop-hint">松开，添加到画布 ${icon('upload')}</div>
        </main>
        <section class="fo-timeline" aria-label="成片镜头序列">
          <div class="fo-timeline-label"><div><span class="fo-eyebrow">THE CUT</span><strong>我的成片</strong></div><span class="fo-sequence-summary">0 个镜头 · 00:00</span><span class="fo-timeline-hint">拖动排序 · 调整秒数</span></div>
          <div class="fo-timeline-track"><div class="fo-sequence-empty"><span class="fo-empty-film">${icon('film')}</span><span>把喜欢的镜头，放到这里。<small>选中素材，点击「加入成片」</small></span><span class="fo-sequence-arrow">↗</span></div><div class="fo-sequence-list"></div></div>
        </section>
        <input type="file" class="fo-file-input" accept="image/*,video/*" multiple hidden>
        <div class="fo-toast" role="status" aria-live="polite"></div>
      </div>
      <dialog class="fo-preview-dialog" aria-labelledby="fo-preview-heading"><div class="fo-preview-head"><div><span class="fo-eyebrow">SCREENING ROOM</span><h2 class="fo-preview-title" id="fo-preview-heading">森林来信</h2></div><button type="button" class="fo-icon-button" data-action="close-preview" aria-label="关闭预览">${icon('x') || '×'}</button></div><div class="fo-preview-screen"></div><div class="fo-preview-description"><span class="fo-preview-shot"></span><span>浏览器内动态预览</span></div><div class="fo-preview-controls"><button type="button" class="fo-icon-button" data-action="prev-preview" aria-label="上一个镜头">${icon('chevron-left') || '‹'}</button><button type="button" class="fo-preview-play" data-action="toggle-preview" aria-label="暂停预览">${icon('pause') || 'Ⅱ'}</button><button type="button" class="fo-icon-button" data-action="next-preview" aria-label="下一个镜头">${icon('chevron-right') || '›'}</button><input class="fo-preview-progress" type="range" min="0" max="4" value="0" step="0.01" aria-label="预览播放位置"><span class="fo-preview-time">00:00 / 00:04</span></div></dialog>
      <dialog class="fo-help-dialog" aria-labelledby="fo-help-heading"><button type="button" class="fo-icon-button fo-help-close" data-action="close-help" aria-label="关闭使用指南">${icon('x') || '×'}</button><span class="fo-eyebrow">A LITTLE GUIDE</span><h2 id="fo-help-heading">把想法摊开，<br>再把故事连起来。</h2><p>画布用来探索和比较。只有加入下方成片区的镜头，才会按顺序播放。</p><dl><div><dt>平移画布</dt><dd>双指滚动 / 滚轮 · 拖动空白处<br>空格 + 拖动，或鼠标中键</dd></div><div><dt>缩放画布</dt><dd>触控板捏合 · ⌘ / Ctrl + 滚轮<br>⌘ / Ctrl ＋ / −，或点击比例</dd></div><div><dt>触屏操作</dt><dd>单指拖动 · 双指平移与缩放</dd></div><div><dt>查看素材</dt><dd>单击选择，双击预览</dd></div><div><dt>撤销 / 重做</dt><dd>⌘ / Ctrl Z · ⇧ ⌘ / Ctrl Z</dd></div><div><dt>删除素材</dt><dd>选中后按 Delete / Backspace</dd></div><div><dt>适应画布</dt><dd>⌘ / Ctrl 0，或点击适应按钮</dd></div></dl><div class="fo-help-note"><strong>这是一间可以动手的演示工作室。</strong><span>真实图片与视频需在 API 设置填写自己的供应商密钥，费用由供应商收取；演示模式使用内置样例。生成素材保存在本浏览器或供应商临时链接，请及时下载。成片区支持顺序预览，尚不导出编码后的 MP4。</span></div><button type="button" class="fo-primary-button" data-action="close-help">开始探索 ${icon('arrow-up-right')}</button></dialog>
    `;
    viewport = root.querySelector('.fo-viewport');
    stage = root.querySelector('.fo-stage');
    sequenceList = root.querySelector('.fo-sequence-list');
    composer = root.querySelector('.fo-composer');
    selectedActions = root.querySelector('.fo-selection-actions');
    zoomLabel = root.querySelector('.fo-zoom-label');
    zoomPopover = root.querySelector('.fo-zoom-popover');
    zoomInput = root.querySelector('.fo-zoom-input');
    try { const mode = localStorage.getItem('frameout-generation-mode'); if (['image', 'video', 'demo'].includes(mode)) generationMode = mode; } catch (_) { /* Default to real image generation. */ }
    generationModeControl = window.FrameoutSelect.create(root.querySelector('.fo-generation-mode'), { host: root.querySelector('.fo-app'), variant: 'compact' });
    apiSettings = window.FrameoutAISettings.create({ root, onChange: () => updateGenerationUI(), onClear: stopGeneration });
    cameraController = window.FrameoutCamera.create({ initial: state.camera, onRender: applyCamera, onRest: save, reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches });
    refreshViewportLayout();
    renderScene();
    updateGenerationUI();
    connectEvents();
    hydrateMedia();
    window.addEventListener('resize', () => {
      if (viewport.clientWidth) { refreshViewportLayout(); applyCamera(); }
    });
  }

  function loadExample(key) {
    if (!mounted) return;
    if (!ASSETS[key]) key = 'forest';
    const names = { forest: '森林来信', ocean: '潮汐来信', city: '午夜漫游' };
    const src = ASSETS[key];
    const existing = state.cards.find((card) => card.src === src);
    if (existing) {
      selectCard(existing.id);
      fit();
      return;
    }
    remember();
    const card = { id: uid(), ...newCardPosition(), name: names[key], src, kind: 'image', crop: '50% 50%', tone: 'normal', label: '灵感样例' };
    state.cards.push(card);
    state.selected = card.id;
    renderScene();
    fit();
    save();
  }

  window.FrameoutStudio = {
    mount,
    fit,
    loadExample,
    enter: () => { refreshViewportLayout(); if (hasSavedCamera) applyCamera(); else fit(false); },
    open: () => { if (typeof window.openStudio === 'function') window.openStudio(); },
    getState: () => state ? { ...clone(state), camera: cameraController.get() } : null,
    pause: () => {
      generationModeControl?.close();
      timelineSelects.forEach(control => control.close());
      closePreview();
      closeZoom();
      resetGesture(true);
      spaceHeld = false;
      viewport.classList.toggle('is-hand', activeTool === 'hand');
      save();
    },
  };
})();
