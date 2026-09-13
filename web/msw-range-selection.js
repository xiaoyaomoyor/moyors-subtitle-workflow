// Source milliseconds survive row virtualization, zoom and rebuildable peaks.
(function (global) {
  'use strict';
  const host = global.MSWE?.resolve('processing-host'), wave = host?.waveform;
  if (!wave) return;
  const node = id => document.getElementById(`msw-range-${id}`);
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const t = value => global.MSWE_I18N?.translateText?.(value) || value;
  let context = null;
  let selection = [], activeIndex = 0, drag = null, frame = 0, suppressClickUntil = 0;
  const copy = values => values.map(value => ({...value}));
  function normalize(values) {
    const result = [];
    for (const value of values) {
      if (!Number.isFinite(value.start) || !Number.isFinite(value.end)) throw Error('时间选区必须是有效时间');
    }
    const sorted = values.map(value => ({
      start: Math.round(clamp(Math.min(value.start, value.end), 0, wave.durationMs)),
      end: Math.round(clamp(Math.max(value.start, value.end), 0, wave.durationMs)),
    })).filter(value => value.end > value.start).sort((a,b) => a.start - b.start);
    for (const value of sorted) {
      const last = result.at(-1);
      if (last && value.start <= last.end) last.end = Math.max(last.end, value.end);
      else result.push(value);
    }
    return result;
  }
  const format = ms => `${Math.floor(ms / 60000)}:${(ms % 60000 / 1000).toFixed(3).padStart(6, '0')}`;
  const menu = document.createElement('div'); menu.className = 'ctxmenu show msw-range-menu'; menu.hidden = true; menu.setAttribute('role','menu');
  let menuTimer = null;
  menu.addEventListener('mouseenter', () => clearTimeout(menuTimer));
  menu.addEventListener('mouseleave', () => {menuTimer = setTimeout(() => {menu.hidden = true;},280);});
  function menuItem(label, {danger=false, shortcut='',window=false}={}) {
    const button = document.createElement('button'); button.type = 'button'; button.className = `item${danger?' danger':''}${window?' ctx-window-item':''}`;
    const text = document.createElement('span'); text.textContent = label; button.append(text);
    if(shortcut){const key=document.createElement('kbd');key.textContent=shortcut;button.append(key);}
    if(window)button.insertAdjacentHTML('beforeend','<svg class="menu-window-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6h11"/></svg>');
    return button;
  }
  const transcribe = menuItem('识别所选片段（ASR）');
  const edit = menuItem('精确编辑时间选区');
  const clear = menuItem('清除时间选区',{danger:true,shortcut:'Esc'});
  const addFromPlayhead = menuItem('加选播放头到鼠标位置');
  const settings = menuItem('波形显示器设置',{window:true});
  settings.addEventListener('click', () => {menu.hidden = true; host.openWaveSettings();});
  const separator = document.createElement('div'); separator.className='sep';
  menu.append(addFromPlayhead, transcribe, edit, clear, separator, settings); document.body.append(menu);
  function sourceRange() {
    const duration = Number(global.MSWE.resolve('media')?.current?.metadata.duration_ms) || 0;
    const range = selection.length === 1 ? selection[0] : null;
    return range && range.start >= 0 && range.end <= duration && range.end > range.start ? {...range} : null;
  }
  function appendBlankMenu(target, time, x, y, close) {
    const duration = wave.durationMs;
    const span = context && context.x === x && context.y === y ? {...context.range}
      : {start:Math.min(time,wave.currentTimeMs()),end:Math.max(time,wave.currentTimeMs())};
    const add = (label, action, disabled) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'item msw-range-action';
      button.textContent = t(label); button.disabled = disabled;
      button.addEventListener('click', () => {close(); action();}); target.append(button);
    };
    add('添加时间选区', () => {
      const start = Math.round(clamp(time,0,Math.max(0,duration-1))), end = Math.min(duration,start+1000);
      setRange([...selection,{start,end}]); activeIndex = selection.findIndex(item => item.start <= start && item.end >= end); openEditor();
    }, !duration);
    add('加选播放头到鼠标位置', () => setRange([...selection,span]), span.start === span.end);
  }
  function setRange(value) {
    selection = normalize(Array.isArray(value) ? value : value ? [value] : []);
    activeIndex = clamp(activeIndex, 0, Math.max(0, selection.length - 1));
    wave.setTimeRange(selection);
    global.dispatchEvent(new CustomEvent('msw:range-changed', {detail: copy(selection)}));
  }
  function stop(event, cancelled = false) {
    if (!drag || (event?.pointerId != null && event.pointerId !== drag.id)) return;
    const previous = drag.previous, moved = drag.moved, id = drag.id;
    drag = null; cancelAnimationFrame(frame); frame = 0;
    try { wave.scroll.releasePointerCapture(id); } catch (_) {}
    wave.manualFollowUntil = Date.now() + 3000;
    if (cancelled || !moved) setRange(previous);
    suppressClickUntil = performance.now() + 200;
    if (event?.cancelable) event.preventDefault();
    event?.stopImmediatePropagation?.();
  }
  function update() {
    if (!drag) return;
    if (!drag.moved && Math.hypot(drag.x - drag.downX, drag.y - drag.downY) < 4) return;
    drag.moved = true;
    const end = Math.round(wave.timeAtViewportPoint(drag.x, drag.y, {unboundedX:Boolean(drag.boundary)}));
    const start = Math.round(drag.start);
    const swept = {start: Math.min(start, end), end: Math.max(start, end)};
    let next;
    if (drag.boundary) {
      next = copy(drag.previous);
      const target = next[drag.boundary.index];
      target[drag.boundary.side] = drag.boundary.side === 'start'
        ? Math.min(end, target.end - 1) : Math.max(end, target.start + 1);
    } else if (drag.operation === 'add') next = [...drag.previous, swept];
    else if (drag.operation === 'subtract') next = drag.previous.flatMap(item => {
      if (swept.end <= item.start || swept.start >= item.end) return [item];
      const pieces = [];
      if (swept.start > item.start) pieces.push({start:item.start, end:swept.start});
      if (swept.end < item.end) pieces.push({start:swept.end, end:item.end});
      return pieces;
    });
    else next = [swept];
    next = normalize(next);
    if (JSON.stringify(next) !== JSON.stringify(selection)) setRange(next);
  }
  function tick() {
    if (!drag) return;
    if (drag.moved) {
      const viewport = wave.scroll.getBoundingClientRect();
      if (wave.isMultiMode()) {
        const toolbar = document.getElementById('msw-source-toolbar');
        const top = toolbar && !toolbar.hidden ? toolbar.getBoundingClientRect().bottom : viewport.top + 28;
        const delta = drag.y < top + 24 ? -clamp((top + 24 - drag.y) / 3, 0, 20)
          : drag.y > viewport.bottom - 24 ? clamp((drag.y - viewport.bottom + 24) / 3, 0, 20) : 0;
        if (delta) { wave.scroll.scrollTop += delta; wave.renderMultiVisible(false); }
      } else {
        const row = wave.renderedRows[0]?.getBoundingClientRect();
        if (row) {
          const direction = drag.x < row.left + 20 ? -1 : drag.x > row.right - 20 ? 1 : 0;
          if (direction) {
            const next = clamp(wave.basicWindowStartMs + direction * wave.settings.visibleSeconds * 10,
              0, Math.max(0, wave.durationMs - wave.settings.visibleSeconds * 1000));
            if (next !== wave.basicWindowStartMs) { wave.basicWindowStartMs = next; wave.renderBasic(); }
          }
        }
      }
      update();
    }
    frame = requestAnimationFrame(tick);
  }
  function boundaryTolerance(x, y, time) {
    return Math.max(Math.abs(wave.timeAtViewportPoint(x + 7,y) - time),
      Math.abs(wave.timeAtViewportPoint(x - 7,y) - time));
  }
  global.addEventListener('pointerdown', event => {
    if (!event.target.closest?.('.msw-range-menu')) menu.hidden = true;
    const ctrl = event.ctrlKey || event.metaKey, temporary = ctrl && event.shiftKey;
    if (event.button !== 0 || (!temporary && wave.getTool() !== 'range') || event.altKey) return;
    const row = event.target.closest?.('.waveform-row');
    if (!row || !wave.scroll.contains(row) || event.target.closest('button,input,select,textarea')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    wave.focusWaveform(); wave.autoScrolling = false; wave.autoScrollTarget = null; wave.manualFollowUntil = Infinity;
    const time = wave.timeAtViewportPoint(event.clientX,event.clientY);
    const tolerance = boundaryTolerance(event.clientX,event.clientY,time);
    let boundary = null, distance = Infinity;
    if (!ctrl && !event.shiftKey && wave.getTool() === 'range') selection.forEach((item,index) => {
      for (const side of ['start','end']) {
        const delta = Math.abs(item[side] - time);
        if (delta <= tolerance && delta < distance) { boundary = {index,side}; distance = delta; }
      }
    });
    drag = {id:event.pointerId, start:time, boundary,
      operation:temporary ? 'replace' : ctrl ? 'subtract' : event.shiftKey ? 'add' : 'replace',
      x:event.clientX,y:event.clientY,downX:event.clientX,downY:event.clientY,previous:copy(selection),moved:false};
    try { wave.scroll.setPointerCapture(event.pointerId); } catch (_) {}
    frame = requestAnimationFrame(tick);
  }, true);
  global.addEventListener('pointermove', event => {
    if (!drag) {
      const inRow = event.target.closest?.('.waveform-row');
      const time = inRow ? wave.timeAtViewportPoint(event.clientX,event.clientY) : 0;
      const tolerance = inRow ? boundaryTolerance(event.clientX,event.clientY,time) : 0;
      wave.scroll.classList.toggle('range-boundary-hover', Boolean(inRow && wave.getTool() === 'range'
        && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
        && selection.some(item => [item.start,item.end].some(edge => Math.abs(edge-time) <= tolerance))));
    }
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault(); event.stopImmediatePropagation(); drag.x = event.clientX; drag.y = event.clientY; update();
  }, true);
  global.addEventListener('pointerup', event => { if (drag) { update(); stop(event); } }, true);
  global.addEventListener('pointercancel', event => stop(event, true), true);
  global.addEventListener('blur', () => stop(null, true));
  global.addEventListener('wheel', event => {
    if (drag) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, {capture:true, passive:false});
  global.addEventListener('click', event => {
    if (performance.now() < suppressClickUntil && wave.scroll.contains(event.target)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  global.addEventListener('keydown', event => {
    if (!drag && document.querySelector('.ctxmenu.show:not(.msw-range-menu)')) return;
    if (event.key !== 'Escape' || (!drag && !selection.length && menu.hidden)) return;
    if (!drag && event.target.closest?.('input,textarea,[contenteditable="true"],dialog')) return;
    event.preventDefault(); event.stopImmediatePropagation(); menu.hidden = true;
    if (drag) stop(null, true); else setRange(null);
  }, true);
  global.addEventListener('contextmenu', event => {
    context = null;
    if (!event.target.closest?.('.waveform-row') || !wave.scroll.contains(event.target)) return;
    if (event.target.closest('.waveform-cue-block,.msw-audio-clip,.waveform-gap-block')) return;
    const time = wave.timeAtViewportPoint(event.clientX, event.clientY);
    const playhead = clamp(wave.currentTimeMs(), 0, wave.durationMs);
    const span = {start:Math.round(Math.min(time,playhead)), end:Math.round(Math.max(time,playhead))};
    context = {x:event.clientX,y:event.clientY,range:span};
    if (!selection.length) return;
    const index = selection.findIndex(item => time >= item.start && time <= item.end);
    if (index < 0) return;
    activeIndex = index;
    event.preventDefault(); event.stopImmediatePropagation();
    const duration = Number(global.MSWE.resolve('media')?.current?.metadata.duration_ms) || 0;
    transcribe.disabled = selection.some(item => item.end > duration) || !global.MSWE.resolve('asr');
    addFromPlayhead.disabled = span.start === span.end;
    addFromPlayhead.onclick = () => {menu.hidden = true; setRange([...selection,span]);};
    clearTimeout(menuTimer); menu.hidden = false;
    const rect=menu.getBoundingClientRect(),first=menu.firstElementChild.getBoundingClientRect();
    menu.style.left = `${clamp(event.clientX-rect.width/2, 4, innerWidth-rect.width-4)}px`;
    menu.style.top = `${clamp(event.clientY-(first.top-rect.top+first.height/2), 4, innerHeight-rect.height-4)}px`;
  }, true);
  function openEditor() {
    const range = selection[activeIndex];
    if (!range) return;
    node('part').replaceChildren(...selection.map((item,index) => {
      const option = document.createElement('option'); option.value = index;
      option.textContent = `${index + 1}. ${format(item.start)}–${format(item.end)}`; return option;
    }));
    node('part').value = activeIndex; node('part-field').hidden = selection.length < 2;
    menu.hidden = true; node('start').value = (range.start / 1000).toFixed(3); node('end').value = (range.end / 1000).toFixed(3);
    node('error').textContent = ''; updateDuration(); node('dialog').showModal(); node('start').select();
  }
  function updateDuration() {
    const duration = Number(node('end').value) - Number(node('start').value);
    node('duration').textContent = t('选区时长') + ' · ' + (Number.isFinite(duration) && duration > 0 ? duration.toFixed(3) : '—') + ' s';
  }
  node('dialog').querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const start = Math.round(Number(node('start').value) * 1000), end = Math.round(Number(node('end').value) * 1000);
    if (!node('start').value || !node('end').value || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > wave.durationMs || !selection[activeIndex]) {
      node('error').textContent = t('请输入时间轴范围内的有效起止时间。'); return;
    }
    const next = copy(selection); next[activeIndex] = {start,end}; setRange(next); node('dialog').close();
  });
  node('part').addEventListener('change', () => {
    activeIndex = Number(node('part').value);
    node('start').value = (selection[activeIndex].start / 1000).toFixed(3);
    node('end').value = (selection[activeIndex].end / 1000).toFixed(3);
    node('error').textContent = '';
    updateDuration();
  });
  for (const key of ['start','end']) node(key).addEventListener('input', () => {node('error').textContent = ''; updateDuration();});
  for (const key of ['close','cancel']) node(key).addEventListener('click', () => node('dialog').close());
  edit.addEventListener('click', openEditor);
  function clearRange() { menu.hidden = true; node('dialog').close(); stop(null,true); setRange(null); }
  clear.addEventListener('click', clearRange);
  transcribe.addEventListener('click', () => { menu.hidden = true; global.MSWE.resolve('asr')?.open('range'); });
  global.addEventListener('msw:project-changed', clearRange); global.addEventListener('msw:media-changed', clearRange);
  global.MSWE.register('time-range', () => ({setRange, clear:clearRange, openEditor, sourceRange, appendBlankMenu,
    get ranges() { return copy(selection); },
    get range() { return selection.length === 1 ? {...selection[0]} : null; }, get dragging() { return Boolean(drag); }}));
})(window);
