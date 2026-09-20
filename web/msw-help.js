// Shared, keyboard-accessible option help. Render outside floating panels so
// long explanations are not clipped by their scrolling bodies.
(function (global) {
  'use strict';
  const t = text => global.MSWE_I18N?.translateText?.(text) || text;
  const popup = document.createElement('div');
  popup.id = 'msw-option-help'; popup.className = 'msw-option-help'; popup.role = 'tooltip'; popup.hidden = true;
  document.body.append(popup);
  let active = null, pinned = false, timer;
  function close() {
    clearTimeout(timer); active?.setAttribute('aria-expanded','false'); active = null; pinned = false; popup.hidden = true;
  }
  function show(button, text) {
    clearTimeout(timer);
    if (active !== button) {close();active = button;}
    popup.textContent = t(typeof text === 'function' ? text() : text); popup.hidden = false;
    button.setAttribute('aria-expanded','true');
    const rect = button.getBoundingClientRect(), box = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(8,Math.min(rect.left,innerWidth-box.width-8))}px`;
    popup.style.top = `${Math.max(8,rect.bottom+box.height+8<innerHeight ? rect.bottom+6 : rect.top-box.height-6)}px`;
  }
  function delayedClose() { if (!pinned) timer = setTimeout(close,150); }
  function attach(target, text) {
    if (!target || target.querySelector(':scope > .msw-help-button')) return;
    const button = document.createElement('button');button.type='button';button.className='msw-help-button';
    button.setAttribute('aria-label',t('说明'));button.setAttribute('aria-describedby',popup.id);button.setAttribute('aria-expanded','false');
    button.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 7v4M8 4.5v.5"/></svg>';
    button.addEventListener('pointerenter',()=>show(button,text));button.addEventListener('pointerleave',delayedClose);
    button.addEventListener('focus',()=>show(button,text));button.addEventListener('blur',delayedClose);
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(active===button&&pinned)close();else{show(button,text);pinned=true;}});
    target.append(button);
  }
  function caption(label) {
    let title = label.querySelector(':scope > .msw-option-label, :scope > .gap-remove-field-label');
    if (!title) {
      title = document.createElement('span');title.className='msw-option-label';
      for (const node of [...label.childNodes]) if (node.nodeType===Node.TEXT_NODE&&node.textContent.trim())title.append(node);
      const check = label.querySelector(':scope > input[type="checkbox"]');
      label.insertBefore(title,check ? check.nextSibling : label.firstChild);
    }
    return title;
  }
  function hydrate(root = document) {
    for (const hint of root.querySelectorAll('[data-help-for]')) {
      const target = document.getElementById(hint.dataset.helpFor);
      if (!target) continue;
      const label = target.closest('label') || (target.matches('details') ? target.querySelector('summary') : target);
      attach(label.matches('label')?caption(label):label,()=>hint.textContent);
      hint.hidden = true;
    }
    for (const hint of root.querySelectorAll('#auto-merge-panel .gap-remove-field small, #subtitle-scale-offset-modal .gap-remove-field small')) {
      attach(caption(hint.closest('label')),hint.textContent);hint.hidden=true;
    }
    for (const label of root.querySelectorAll('[data-option-help]')) attach(caption(label),label.dataset.optionHelp);
  }
  popup.addEventListener('pointerenter',()=>clearTimeout(timer));popup.addEventListener('pointerleave',delayedClose);
  document.addEventListener('pointerdown',e=>{if(active&&!active.contains(e.target)&&!popup.contains(e.target))close();},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active){close();e.stopImmediatePropagation();e.preventDefault();}},true);
  global.addEventListener('resize',close);document.addEventListener('scroll',()=>{if(!pinned)close();},true);
  global.MSWHelp = {hydrate,attach,close};hydrate();
})(window);
