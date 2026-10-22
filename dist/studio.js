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
        const cards = saved.cards.filter((card) => card && typeof card.id === 'string' && typeof card.src === 'string' && !card.src.startsWith('blob:') && Number.isFinite(card.x) && Number.isFinite(card.y));
        return { ...initialState(), ...saved, cards, sequence: saved.sequence.filter((item) => cards.some((card) => card.id === item.cardId)).map((item) => ({ ...item, duration: clamp(Number(item.duration) || 4, 1, 15) })), camera: { ...initialState().camera, ...saved.camera } };
      }
    } catch (_) { /* A new workspace is a valid recovery path. */ }
    return initialState();
  }

  function snapshot() {
    return clone({ cards: state.cards, sequence: state.sequence, selected: state.selected, title: state.title });
  }

  function remember(before) {
    undoStack.push(before || snapshot());
    if (undoStack.length > 40) undoStack.shift();
    redoStack = [];
    refreshHistoryButtons();
  }

  function applySnapshot(value) {
    Object.assign(state, clone(value));
    renderScene();
    save();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    applySnapshot(undoStack.pop());
    refreshHistoryButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    applySnapshot(redoStack.pop());
    refreshHistoryButtons();
  }

  function refreshHistoryButtons() {
    if (!root) return;
    root.querySelector('[data-action="undo"]').disabled = undoStack.length === 0;
    root.querySelector('[data-action="redo"]').disabled = redoStack.length === 0;
  }

  function save() {
    clearTimeout(saveTimer);
    const label = root.querySelector('.fo-save-label');
    label.textContent = '正在保存';
    saveTimer = setTimeout(() => {
      try {
        const saved = clone(state);
        saved.cards = saved.cards.filter((card) => !card.sessionOnly);
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
    return { x: (clientX - rect.left - state.camera.x) / state.camera.zoom, y: (clientY - rect.top - state.camera.y) / state.camera.zoom };
  }

  function applyCamera() {
    const { x, y, zoom } = state.camera;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    viewport.style.backgroundSize = `${26 * zoom}px ${26 * zoom}px`;
    viewport.style.backgroundPosition = `${x}px ${y}px`;
    root.querySelector('.fo-zoom-label').textContent = Math.round(zoom * 100) + '%';
  }

  function zoomBy(factor, clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    const x = clientX === undefined ? rect.left + rect.width / 2 : clientX;
    const y = clientY === undefined ? rect.top + rect.height / 2 : clientY;
    const world = cameraToWorld(x, y);
    state.camera.zoom = clamp(state.camera.zoom * factor, 0.22, 2.5);
    state.camera.x = x - rect.left - world.x * state.camera.zoom;
    state.camera.y = y - rect.top - world.y * state.camera.zoom;
    applyCamera();
    save();
  }

  function fit() {
    if (!viewport || !viewport.clientWidth) return;
    const cards = state.cards;
    if (!cards.length) {
      state.camera = { x: 60, y: 10, zoom: 0.8 };
    } else {
      const left = Math.min(...cards.map((card) => card.x)) - 60;
      const top = Math.min(...cards.map((card) => card.y)) - 70;
      const width = Math.max(...cards.map((card) => card.x + 270)) - left + 70;
      const height = Math.max(...cards.map((card) => card.y + 225)) - top + 70;
      const availableHeight = Math.max(160, viewport.clientHeight - 150);
      const zoom = clamp(Math.min((viewport.clientWidth - (viewport.clientWidth < 600 ? 34 : 145)) / width, availableHeight / height), 0.22, 1.12);
      state.camera = { zoom, x: (viewport.clientWidth - width * zoom) / 2 - left * zoom + (viewport.clientWidth < 600 ? 12 : 25), y: (availableHeight - height * zoom) / 2 - top * zoom + 30 };
    }
    applyCamera();
    save();
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
    const media = document.createElement(card.kind === 'video' ? 'video' : 'img');
    media.className = className || '';
    media.src = card.src;
    media.draggable = false;
    if (card.kind === 'video') {
      media.muted = true;
      media.playsInline = true;
      media.preload = 'metadata';
    } else {
      media.alt = card.name;
    }
    media.style.objectPosition = card.crop || '50% 50%';
    return media;
  }

  function renderScene() {
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
      item.style.left = card.x + 'px';
      item.style.top = card.y + 'px';
      const header = document.createElement('div');
      header.className = 'fo-card-top';
      const kind = document.createElement('span');
      kind.innerHTML = icon(card.motion || card.kind === 'video' ? 'film' : 'image');
      kind.append(document.createTextNode(card.motion ? '动态预览' : card.kind === 'video' ? '本地视频' : card.sessionOnly ? '本地图片' : card.label || '画面'));
      const detail = document.createElement('span');
      detail.textContent = card.motion ? '4 SEC' : '16:9';
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
      label.textContent = card.sessionOnly ? 'LOCAL' : 'EXPLORATION';
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
    selectedActions.hidden = !card;
    if (!card) return;
    selectedActions.querySelector('.fo-selected-name').textContent = card.name;
    const videoButton = selectedActions.querySelector('[data-action="motion"]');
    videoButton.disabled = busy || card.kind === 'video';
    videoButton.title = card.kind === 'video' ? '这个素材已经是视频' : '使用示例画面展示动态预览';
  }

  function renderSequence() {
    const previousPositions = new Map(Array.from(sequenceList.children, (item) => [item.dataset.sequenceId, item.offsetLeft]));
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
      const time = document.createElement('label');
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
    }
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const element of sequenceList.children) {
        const previous = previousPositions.get(element.dataset.sequenceId);
        const offset = previous === undefined ? 0 : previous - element.offsetLeft;
        if (offset) element.animate([{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0)' }], { duration: 340, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
    }
  }

  function addToSequence(cardId) {
    if (!state.cards.some((card) => card.id === cardId)) return;
    remember();
    state.sequence.push({ id: uid(), cardId, duration: 4 });
    renderSequence();
    save();
    toast('已加入成片 · 在下方拖动调整顺序');
  }

  function removeSelected() {
    if (!state.selected) return;
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

  function setBusy(value) {
    busy = value;
    composer.classList.toggle('is-busy', value);
    const button = root.querySelector('[data-action="generate"]');
    button.disabled = value;
    button.querySelector('span').textContent = value ? '正在准备画面' : '演示生成';
    root.querySelector('.fo-generation-state').textContent = value ? '正在用示例素材演示生成过程…' : '内置示例素材 · 无需账号';
    renderSelection();
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
    const project = { ...clone(state), exportedAt: new Date().toISOString(), format: 'FRAMEOUT demo project', notice: '这是项目 JSON，不是视频文件。本地导入素材需要重新选择原文件。' };
    project.cards = project.cards.map((card) => card.sessionOnly ? { ...card, src: '', relinkRequired: true } : card);
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
    const items = single && selected ? [{ card: selected, duration: 4 }] : state.sequence.map((item) => ({ card: state.cards.find((card) => card.id === item.cardId), duration: item.duration })).filter((item) => item.card);
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
      case 'close-help': root.querySelector('.fo-help-dialog').close(); break;
      case 'upload': root.querySelector('.fo-file-input').click(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'zoom-in': zoomBy(1.2); break;
      case 'zoom-out': zoomBy(1 / 1.2); break;
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
    return target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable="true"]'));
  }

  function connectEvents() {
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (button && !button.disabled) handleAction(button.dataset.action);
      const tool = event.target.closest('[data-tool]');
      if (tool) setTool(tool.dataset.tool);
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
      zoomBy(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
    }, { passive: false });
    viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.button !== 1) return;
      if (event.target.closest('.fo-composer, .fo-selection-actions, .fo-canvas-tools, .fo-camera-tools, .fo-canvas-intro')) return;
      const cardElement = event.target.closest('.fo-card');
      const card = cardElement && state.cards.find((item) => item.id === cardElement.dataset.id);
      const hand = spaceHeld || activeTool === 'hand' || event.button === 1;
      if (card && !hand) {
        selectCard(card.id);
        drag = { kind: 'card', id: card.id, element: cardElement, startX: event.clientX, startY: event.clientY, x: card.x, y: card.y, before: snapshot(), moved: false };
      } else {
        if (!hand) selectCard(null);
        drag = { kind: 'camera', startX: event.clientX, startY: event.clientY, x: state.camera.x, y: state.camera.y, moved: false };
        viewport.classList.add('is-panning');
      }
      viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.kind === 'camera') {
        state.camera.x = drag.x + dx;
        state.camera.y = drag.y + dy;
        applyCamera();
      } else {
        const card = state.cards.find((item) => item.id === drag.id);
        if (!card) return;
        card.x = drag.x + dx / state.camera.zoom;
        card.y = drag.y + dy / state.camera.zoom;
        drag.element.style.left = card.x + 'px';
        drag.element.style.top = card.y + 'px';
        drag.element.classList.toggle('is-dragging', drag.moved);
      }
    });
    function endDrag(event) {
      if (!drag) return;
      if (drag.kind === 'card') {
        drag.element.classList.remove('is-dragging');
        if (drag.moved) remember(drag.before);
        const timeline = root.querySelector('.fo-timeline').getBoundingClientRect();
        if (drag.moved && event.clientY >= timeline.top && event.clientY <= timeline.bottom) addToSequence(drag.id);
      }
      viewport.classList.remove('is-panning');
      drag = null;
      save();
    }
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);
    viewport.addEventListener('dblclick', (event) => {
      if (event.target.closest('.fo-card,button,textarea')) return;
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
      if (event.code === 'Space') {
        spaceHeld = true;
        viewport.classList.add('is-hand');
        event.preventDefault();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (state.selected) { event.preventDefault(); removeSelected(); }
      } else if (event.key.toLowerCase() === 'v') setTool('select');
      else if (event.key.toLowerCase() === 'h') setTool('hand');
      else if (event.key === 'Escape') selectCard(null);
      else if (event.key === '0' && !event.metaKey && !event.ctrlKey) fit();
    });
    document.addEventListener('keyup', (event) => {
      if (event.code === 'Space') {
        spaceHeld = false;
        if (viewport) viewport.classList.toggle('is-hand', activeTool === 'hand');
      }
    });
    window.addEventListener('blur', () => {
      spaceHeld = false;
      drag = null;
      viewport.classList.remove('is-panning');
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
          <div class="fo-header-actions"><button type="button" class="fo-text-button fo-export-button" data-action="export">${icon('download')}<span>导出项目</span></button><button type="button" class="fo-primary-button" data-action="preview">${icon('play')}<span>预览成片</span></button></div>
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
          <div class="fo-selection-actions" hidden><span class="fo-selected-name"></span><button type="button" class="fo-small-button" data-action="motion">${icon('film')}<span>演示生成视频</span></button><button type="button" class="fo-small-button fo-add-shot" data-action="add">${icon('plus')}<span>加入成片</span></button><button type="button" class="fo-icon-button" data-action="delete" aria-label="删除选中素材" title="删除素材">${icon('trash') || '×'}</button></div>
          <form class="fo-composer" onsubmit="return false">
            <div class="fo-composer-top"><label for="fo-prompt">让想法，先有一个画面。</label><span class="fo-demo-badge"><i></i>演示模式</span></div>
            <textarea class="fo-prompt" id="fo-prompt" rows="1" placeholder="森林深处，一位宇航员抬头看光…" maxlength="500"></textarea>
            <div class="fo-composer-bottom"><span class="fo-generation-state">内置示例素材 · 无需账号</span><button type="button" class="fo-generate-button" data-action="generate">${icon('sparkles')}<span>演示生成</span>${icon('arrow-up-right')}</button></div>
            <div class="fo-generation-line"></div>
          </form>
          <div class="fo-camera-tools" aria-label="缩放控制"><button type="button" class="fo-icon-button" data-action="zoom-out" aria-label="缩小">${icon('minus') || '−'}</button><span class="fo-zoom-label">80%</span><button type="button" class="fo-icon-button" data-action="zoom-in" aria-label="放大">${icon('plus') || '+'}</button><span class="fo-tool-divider"></span><button type="button" class="fo-icon-button" data-action="fit" aria-label="适应全部素材" title="适应全部素材 · 0">${icon('maximize') || '⛶'}</button></div>
          <div class="fo-canvas-hint"><span>滚轮缩放</span><i>·</i><span>空格拖动画布</span><i>·</i><span>双击画面预览</span></div>
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
      <dialog class="fo-help-dialog" aria-labelledby="fo-help-heading"><button type="button" class="fo-icon-button fo-help-close" data-action="close-help" aria-label="关闭使用指南">${icon('x') || '×'}</button><span class="fo-eyebrow">A LITTLE GUIDE</span><h2 id="fo-help-heading">把想法摊开，<br>再把故事连起来。</h2><p>画布用来探索和比较。只有加入下方成片区的镜头，才会按顺序播放。</p><dl><div><dt>平移画布</dt><dd>拖动空白处，或按住空格拖动</dd></div><div><dt>缩放画布</dt><dd>滚轮，或右下角 ＋ / −</dd></div><div><dt>查看素材</dt><dd>单击选择，双击预览</dd></div><div><dt>撤销 / 重做</dt><dd>⌘ / Ctrl Z · ⇧ ⌘ / Ctrl Z</dd></div><div><dt>删除素材</dt><dd>选中后按 Delete / Backspace</dd></div><div><dt>适应画布</dt><dd>按 0，或点击适应按钮</dd></div></dl><div class="fo-help-note"><strong>这是一间可以动手的演示工作室。</strong><span>演示生成使用内置样例；动态预览展示镜头运动效果。真实 AI 生成与视频编码尚未接入。项目保存在当前浏览器，本地导入文件仅本次页面会话可用。</span></div><button type="button" class="fo-primary-button" data-action="close-help">开始探索 ${icon('arrow-up-right')}</button></dialog>
    `;
    viewport = root.querySelector('.fo-viewport');
    stage = root.querySelector('.fo-stage');
    sequenceList = root.querySelector('.fo-sequence-list');
    composer = root.querySelector('.fo-composer');
    selectedActions = root.querySelector('.fo-selection-actions');
    renderScene();
    connectEvents();
    window.addEventListener('resize', () => {
      if (viewport.clientWidth) applyCamera();
    });
    requestAnimationFrame(() => { if (viewport.clientWidth) fit(); });
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
    open: () => { if (typeof window.openStudio === 'function') window.openStudio(); },
    getState: () => state ? clone(state) : null,
    pause: closePreview,
  };
})();
