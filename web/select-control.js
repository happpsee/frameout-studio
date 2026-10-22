/* FRAMEOUT · accessible page-styled select, backed by the original form control. */
(function (scope, factory) {
  'use strict';
  const api = factory();
  scope.FrameoutSelect = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';

  let nextId = 0;
  let opened = null;

  function create(select, { host, variant = 'default' } = {}) {
    if (!select?.ownerDocument || select.tagName !== 'SELECT') throw new Error('请选择一个已挂载的 select 元素');
    const document = select.ownerDocument;
    const view = document.defaultView;
    host = host || select.closest('dialog') || document.body;
    const original = { hidden: select.hidden, tabindex: select.getAttribute('tabindex'), ariaHidden: select.getAttribute('aria-hidden'), required: select.required, id: select.id };
    const prefix = 'fo-select-' + (++nextId);
    if (!select.id) select.id = prefix + '-native';
    select.hidden = true;
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    select.required = false;

    const wrapper = document.createElement('div');
    wrapper.className = 'fo-select';
    wrapper.dataset.variant = variant;
    wrapper.draggable = false;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'fo-select-trigger';
    trigger.draggable = false;
    trigger.id = prefix + '-trigger';
    trigger.dataset.selectFor = select.id;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', prefix + '-menu');
    const value = document.createElement('span');
    value.className = 'fo-select-value';
    const chevron = document.createElement('span');
    chevron.className = 'fo-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    trigger.append(value, chevron);
    wrapper.append(trigger);
    select.parentNode.insertBefore(wrapper, select.nextSibling);

    const labels = Array.from(document.querySelectorAll('label[for]')).filter(label => label.htmlFor === select.id).map((label, index) => {
      const item = { element: label, htmlFor: label.htmlFor, id: label.id };
      if (!label.id) label.id = prefix + '-label-' + index;
      label.htmlFor = trigger.id;
      return item;
    });
    const labelledBy = labels.map(item => item.element.id).join(' ') || select.getAttribute('aria-labelledby');
    if (labelledBy) trigger.setAttribute('aria-labelledby', labelledBy);
    else trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || '选择选项');
    const describedBy = select.getAttribute('aria-describedby');
    if (describedBy) trigger.setAttribute('aria-describedby', describedBy);

    const menu = document.createElement('div');
    menu.className = 'fo-select-menu';
    menu.dataset.variant = variant;
    menu.draggable = false;
    menu.id = prefix + '-menu';
    menu.setAttribute('role', 'listbox');
    if (labelledBy) menu.setAttribute('aria-labelledby', labelledBy);
    else menu.setAttribute('aria-label', trigger.getAttribute('aria-label'));
    menu.hidden = true;
    menu.style.position = 'fixed';
    host.append(menu);

    let options = [], active = -1, isOpen = false, destroyed = false, search = '', searchTimer = null;
    const instance = { element: wrapper, trigger, refresh, focus: (options) => trigger.focus(options || { preventScroll: true }), close: () => close(false), destroy };
    const enabled = () => options.filter(item => !item.disabled);
    const textOf = option => option.label || option.textContent || '';

    function clearSearch() {
      search = '';
      if (searchTimer !== null) view.clearTimeout(searchTimer);
      searchTimer = null;
    }

    function highlight(index, scroll = true) {
      active = options.some(item => item.index === index && !item.disabled) ? index : -1;
      for (const item of options) item.button.classList.toggle('is-active', item.index === active);
      const option = options.find(item => item.index === active);
      if (option && isOpen) {
        trigger.setAttribute('aria-activedescendant', option.button.id);
        if (scroll && isOpen) {
          const box = option.button.getBoundingClientRect();
          const frame = menu.getBoundingClientRect();
          if (box.top < frame.top) menu.scrollTop -= frame.top - box.top;
          else if (box.bottom > frame.bottom) menu.scrollTop += box.bottom - frame.bottom;
        }
      } else trigger.removeAttribute('aria-activedescendant');
    }

    function position() {
      if (!isOpen || destroyed) return;
      const box = trigger.getBoundingClientRect();
      const boundary = host.getBoundingClientRect();
      const isBody = host === document.body || host === document.documentElement;
      const leftBound = Math.max(8, isBody ? 8 : boundary.left + 8);
      const rightBound = Math.min(view.innerWidth - 8, isBody ? view.innerWidth - 8 : boundary.right - 8);
      const topBound = Math.max(8, isBody ? 8 : boundary.top + 8);
      const bottomBound = Math.min(view.innerHeight - 8, isBody ? view.innerHeight - 8 : boundary.bottom - 8);
      if (!box.width || box.bottom < topBound || box.top > bottomBound || rightBound <= leftBound) { close(false); return; }
      const minimumWidth = variant === 'compact' ? 144 : variant === 'duration' ? 108 : 0;
      const width = Math.min(Math.max(box.width, minimumWidth), rightBound - leftBound);
      const anchorLeft = minimumWidth ? box.right - width : box.left;
      const left = Math.max(leftBound, Math.min(anchorLeft, rightBound - width));
      const below = bottomBound - box.bottom - 6;
      const above = box.top - topBound - 6;
      const upward = below < 160 && above > below;
      const room = Math.max(0, upward ? above : below);
      if (room < 28) { close(false); return; }
      const height = Math.min(280, room);
      menu.style.width = width + 'px';
      menu.style.left = left + 'px';
      menu.style.maxHeight = height + 'px';
      menu.style.overflowY = 'auto';
      menu.dataset.side = upward ? 'top' : 'bottom';
      const actualHeight = Math.min(menu.scrollHeight, height);
      menu.style.top = (upward ? box.top - 6 - actualHeight : box.bottom + 6) + 'px';
    }

    function refresh() {
      if (destroyed) return;
      const lastActive = active;
      options = [];
      menu.replaceChildren();
      for (const [index, option] of Array.from(select.options).entries()) {
        const group = option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement : null;
        if (option.hidden || group?.hidden) continue;
        const disabled = option.disabled || Boolean(group?.disabled);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'fo-select-option';
        button.dataset.optionIndex = String(index);
        button.draggable = false;
        button.id = prefix + '-option-' + index;
        button.tabIndex = -1;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(index === select.selectedIndex));
        button.setAttribute('aria-disabled', String(disabled));
        button.disabled = disabled;
        button.classList.toggle('is-selected', index === select.selectedIndex);
        const label = document.createElement('span');
        label.className = 'fo-select-option-label';
        label.textContent = textOf(option);
        const check = document.createElement('span');
        check.className = 'fo-select-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = '✓';
        check.style.visibility = index === select.selectedIndex ? 'visible' : 'hidden';
        button.append(label, check);
        options.push({ index, option, button, disabled });
        menu.append(button);
      }
      if (!options.length) {
        const empty = document.createElement('div');
        empty.className = 'fo-select-empty';
        empty.textContent = '暂无可选项';
        menu.append(empty);
      }
      const selected = select.options[select.selectedIndex];
      value.textContent = selected ? textOf(selected) : '请选择';
      trigger.disabled = select.disabled;
      trigger.setAttribute('aria-disabled', String(select.disabled));
      wrapper.classList.toggle('is-disabled', select.disabled);
      if (select.disabled) { close(false); return; }
      const fallback = options.find(item => item.index === select.selectedIndex && !item.disabled) || enabled()[0];
      highlight(isOpen && options.some(item => item.index === lastActive && !item.disabled) ? lastActive : fallback?.index ?? -1, false);
      if (isOpen) { position(); highlight(active); }
    }

    function open() {
      if (destroyed || select.disabled) return;
      if (opened && opened !== instance) opened.close();
      refresh();
      isOpen = true;
      opened = instance;
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      wrapper.classList.add('is-open');
      trigger.focus({ preventScroll: true });
      position();
      highlight(active);
    }

    function close(returnFocus) {
      if (destroyed) return;
      isOpen = false;
      if (opened === instance) opened = null;
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      wrapper.classList.remove('is-open');
      clearSearch();
      if (returnFocus && !trigger.disabled) trigger.focus({ preventScroll: true });
    }

    function choose(index) {
      const item = options.find(value => value.index === index);
      if (!item || item.disabled || select.disabled) return;
      const changed = select.selectedIndex !== index;
      select.selectedIndex = index;
      close(true);
      if (changed) {
        select.dispatchEvent(new view.Event('input', { bubbles: true }));
        select.dispatchEvent(new view.Event('change', { bubbles: true }));
      }
      refresh();
    }

    function move(direction) {
      const candidates = enabled();
      if (!candidates.length) return;
      const index = candidates.findIndex(item => item.index === active);
      const target = Math.max(0, Math.min(candidates.length - 1, index < 0 ? direction > 0 ? 0 : candidates.length - 1 : index + direction));
      highlight(candidates[target].index);
    }

    function typeahead(character) {
      if (!isOpen) open();
      if (!isOpen) return;
      if (searchTimer !== null) view.clearTimeout(searchTimer);
      search += character.toLocaleLowerCase();
      searchTimer = view.setTimeout(clearSearch, 650);
      const needle = search.length > 1 && Array.from(search).every(letter => letter === search[0]) ? search[0] : search;
      const candidates = enabled();
      const current = candidates.findIndex(item => item.index === active);
      const start = needle.length === 1 ? current + 1 : current;
      for (let offset = 0; offset < candidates.length; offset++) {
        const candidate = candidates[(Math.max(0, start) + offset) % candidates.length];
        if (textOf(candidate.option).trim().toLocaleLowerCase().startsWith(needle)) { highlight(candidate.index); break; }
      }
    }

    function onKey(event) {
      if (select.disabled) return;
      if (event.key === 'Escape' && isOpen) {
        event.preventDefault(); event.stopPropagation(); close(true); return;
      }
      if (event.key === 'Tab') { close(false); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation();
        if (!isOpen) open(); else move(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); event.stopPropagation();
        if (!isOpen) open();
        const candidates = enabled();
        highlight((event.key === 'Home' ? candidates[0] : candidates[candidates.length - 1])?.index ?? -1);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); event.stopPropagation();
        if (isOpen) choose(active); else open();
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); typeahead(event.key); }
    }

    function outside(event) {
      if (isOpen && !wrapper.contains(event.target) && !menu.contains(event.target)) close(false);
    }
    function onScroll(event) {
      if (isOpen && !menu.contains(event.target)) close(false);
    }
    function onHostClose() { close(false); }
    function keepTriggerFocus(event) { event.preventDefault(); event.stopPropagation(); }
    function stopPointer(event) { event.stopPropagation(); }
    function stopDrag(event) { event.preventDefault(); event.stopPropagation(); }
    function menuOption(event) {
      const button = event.target.closest('.fo-select-option');
      if (!button || !menu.contains(button)) return null;
      return options.find(item => item.index === Number(button.dataset.optionIndex)) || null;
    }
    function onMenuMove(event) {
      const item = menuOption(event);
      if (item && !item.disabled) highlight(item.index, false);
    }
    function onMenuClick(event) {
      const item = menuOption(event);
      if (item) { event.stopPropagation(); choose(item.index); }
    }
    function onClick() { if (isOpen) close(false); else open(); }
    function onBlur(event) { if (isOpen && !menu.contains(event.relatedTarget)) close(false); }

    trigger.addEventListener('click', onClick);
    trigger.addEventListener('pointerdown', stopPointer);
    trigger.addEventListener('dragstart', stopDrag);
    trigger.addEventListener('keydown', onKey);
    trigger.addEventListener('blur', onBlur);
    menu.addEventListener('pointerdown', keepTriggerFocus);
    menu.addEventListener('dragstart', stopDrag);
    menu.addEventListener('pointermove', onMenuMove);
    menu.addEventListener('click', onMenuClick);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', onScroll, true);
    view.addEventListener('resize', position);
    host.addEventListener('close', onHostClose);
    select.addEventListener('change', refresh);
    select.addEventListener('input', refresh);
    const observer = typeof view.MutationObserver === 'function' ? new view.MutationObserver(refresh) : null;
    observer?.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'label', 'selected'] });
    refresh();

    function restoreAttribute(element, name, value) {
      if (value === null) element.removeAttribute(name); else element.setAttribute(name, value);
    }

    function destroy() {
      if (destroyed) return;
      close(false);
      destroyed = true;
      observer?.disconnect();
      trigger.removeEventListener('click', onClick);
      trigger.removeEventListener('pointerdown', stopPointer);
      trigger.removeEventListener('dragstart', stopDrag);
      trigger.removeEventListener('keydown', onKey);
      trigger.removeEventListener('blur', onBlur);
      menu.removeEventListener('pointerdown', keepTriggerFocus);
      menu.removeEventListener('dragstart', stopDrag);
      menu.removeEventListener('pointermove', onMenuMove);
      menu.removeEventListener('click', onMenuClick);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', onScroll, true);
      view.removeEventListener('resize', position);
      host.removeEventListener('close', onHostClose);
      select.removeEventListener('change', refresh);
      select.removeEventListener('input', refresh);
      for (const item of labels) {
        item.element.htmlFor = item.htmlFor;
        if (!item.id) item.element.removeAttribute('id');
      }
      select.hidden = original.hidden;
      select.required = original.required;
      restoreAttribute(select, 'tabindex', original.tabindex);
      restoreAttribute(select, 'aria-hidden', original.ariaHidden);
      if (!original.id) select.removeAttribute('id');
      wrapper.remove();
      menu.remove();
      options = [];
      active = -1;
    }

    return instance;
  }

  return { create };
});
