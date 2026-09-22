// Explicit explanations only: errors, requirements and progress stay visible.
(function () {
  'use strict';
  const root = document.createElement('div');
  root.className = 'module-help-popover';
  root.setAttribute('popover', 'auto');
  root.setAttribute('role', 'note');
  root.id = 'moduleHelpPopover';
  document.body.append(root);
  let anchor = null, pinned = false, closeTimer = 0;
  const buttons = [];
  const isOpen = () => root.matches(':popover-open');
  function close() {
    clearTimeout(closeTimer);
    if (isOpen()) root.hidePopover();
    anchor?.setAttribute('aria-expanded', 'false');
    anchor = null;
    pinned = false;
  }
  function show(button, note) {
    clearTimeout(closeTimer);
    if (anchor !== button) close();
    anchor = button;
    root.textContent = note.textContent;
    if (!isOpen()) root.showPopover();
    button.setAttribute('aria-expanded', 'true');
    position();
  }
  function position() {
    if (!anchor || !isOpen()) return;
    const pagePixels = value => window.MSWLauncher?.viewportPixelsToPage(value) ?? value;
    root.style.maxWidth = pagePixels(innerWidth - 16) + 'px';
    root.style.maxHeight = pagePixels(innerHeight - 16) + 'px';
    const r = anchor.getBoundingClientRect(), popup = root.getBoundingClientRect();
    root.style.left = pagePixels(Math.max(8, Math.min(r.left, innerWidth - popup.width - 8))) + 'px';
    root.style.top = pagePixels(Math.max(8, Math.min(r.bottom + 6, innerHeight - popup.height - 8))) + 'px';
  }
  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!pinned && document.activeElement !== anchor && !root.matches(':hover')) close();
    }, 180);
  }
  function localizeButtons() {
    buttons.forEach(button => button.setAttribute('aria-label', window.MSWLauncher.translate('explanation')));
  }
  function attach() {
    document.querySelectorAll('p[data-help][data-i18n]').forEach((note, index) => {
      // No length heuristic: help is identical in every language.
      const scope = note.closest('.settings-section, .tool-page-panel, .module-card');
      const label = (note.dataset.helpFor && document.querySelector(note.dataset.helpFor))
        || note.closest('.field')?.querySelector('label') || scope?.querySelector('h2, h3');
      if (!label || note.dataset.helpAttached) return;
      if (label.dataset.i18n) {
        const text = document.createElement('span');
        text.dataset.i18n = label.dataset.i18n;
        text.textContent = label.textContent;
        delete label.dataset.i18n;
        label.replaceChildren(text);
      }
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'module-help'; button.textContent = 'ⓘ';
      note.id ||= `moduleHelpNote${index}`;
      button.setAttribute('aria-describedby', note.id);
      button.setAttribute('aria-controls', root.id);
      button.setAttribute('aria-expanded', 'false');
      button.addEventListener('pointerenter', () => show(button, note));
      button.addEventListener('pointerleave', scheduleClose);
      button.addEventListener('focus', () => show(button, note));
      button.addEventListener('blur', scheduleClose);
      button.addEventListener('click', event => {
        event.preventDefault(); // Help inside a checkbox label must not toggle it.
        if (anchor === button && isOpen() && pinned) close();
        else { show(button, note); pinned = true; }
      });
      label.append(button); buttons.push(button);
      note.hidden = true; note.dataset.helpAttached = 'true';
    });
    localizeButtons();
  }
  root.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  root.addEventListener('pointerleave', scheduleClose);
  root.addEventListener('beforetoggle', event => {
    if (event.newState === 'closed') anchor?.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault(); event.stopImmediatePropagation(); close();
    }
  }, true);
  document.addEventListener('pointerdown', event => {
    if (isOpen() && !root.contains(event.target) && !anchor?.contains(event.target)) close();
  }, true);
  document.addEventListener('scroll', event => {
    if (event.target !== root) requestAnimationFrame(() => {
      if (anchor && !anchor.checkVisibility()) close(); else position();
    });
  }, true);
  window.addEventListener('resize', close);
  document.addEventListener('mswnavigation', close);
  document.addEventListener('mswlanguage', () => { close(); localizeButtons(); });
  window.addEventListener('mawlauncherready', attach);
})();
