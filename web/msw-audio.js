// Audio clips have their own selection/gestures; subtitle edit rules stay local.
(function (global) {
  'use strict';
  const host = global.MSWE?.resolve('processing-host'), timeline = host?.timeline, core = global.MSWAudio;
  if (!timeline || !core) return;
  const t = s => global.MSWE_I18N?.translateText?.(s) || s;
  const selected = new Set(), MIME = 'application/x-msw-audio-asset', ROW = 22, EMPTY = Object.freeze([]), EMPTY_EXTENSION = Object.freeze({});
  let dataRef, clipsRef, assetsRef, tracksRef, state, drag = null, repaint = 0, menu, menuTimer, gapSource, protectedRanges;
  // lane 记忆跨 state 重建长期保存：重叠中的贴片拖动/松手都不换位；
  // 分离的贴片由 arrange 的重叠规则自动折叠回单轨（不会阻碍收纳）。
  let lastLanes = null;
  let laneScroll = new Map();
  const extension = () => host.data.msw || EMPTY_EXTENSION;
  function sync() {
    const ext = extension(), clips = drag?.preview || ext.audio_clips || EMPTY;
    if (state && dataRef === ext && clipsRef === clips && assetsRef === ext.assets && tracksRef === ext.audio_tracks) return state;
    const timelineChanged = !!state && (dataRef !== ext || clipsRef !== clips || tracksRef !== ext.audio_tracks);
    dataRef = ext; clipsRef = clips; assetsRef = ext.assets; tracksRef = ext.audio_tracks;
    const assets = new Map((ext.assets || []).map(a => [a.id, a])), tracks = new Map((ext.audio_tracks || []).map(a => [a.id, a]));
    const arranged = core.arrange(clips, assets, lastLanes);
    state = { clips, assets, tracks, ...arranged, audible: core.audible({ ...ext, audio_clips: clips }),
      end: clips.reduce((n, c) => Math.max(n, assets.has(c.asset_id) ? core.end(c, assets.get(c.asset_id)) : 0), 0) };
    lastLanes = arranged.lanes;
    gapSource = null;
    for (const id of selected) if (!clips.some(c => c.id === id)) selected.delete(id);
    if (timelineChanged && !drag) { refreshSettings(); transport.reset(); }
    return state;
  }
  const hint = message => host.flashHint(t(message));
  function schedulePaint() {
    if (repaint) return;
    repaint = requestAnimationFrame(() => { repaint = 0; timeline.refreshOverlays(); });
  }
  const transport = global.MSWAudioTransport.create({ player: host.player, getState: sync, changed: schedulePaint, hint,
    frame: () => host.refreshAudioPlayback(transport.currentTime()),
    beforePlay: () => host.assetLibrary?.querySelector('audio')?.pause(),
    skipAt: time => host.audioPlaybackSkip(time),
    load: async (asset, signal) => {
      if (!host.config?.processingUrl) throw Error('请通过本机编辑器服务打开音频素材');
      const projectId = extension().project_id;
      const response = await fetch(`${host.config.processingUrl}/asset-audio?project_id=${encodeURIComponent(projectId)}&asset_id=${encodeURIComponent(asset.id)}`,
        { headers: { 'X-MSW-Token': host.config.requestToken }, signal, cache: 'no-store' });
      if (!response.ok) throw Error(response.status === 404 ? '素材缺失，请恢复工程旁的素材目录' : '音频加载失败，请检查本机服务');
      return response.arrayBuffer();
    } });
  function commit(label, change) { closeMenu(); transport.reset(); host.commitAudio(t(label), change); }
  function insert(assetId, at = transport.currentTime() ?? (host.player.currentTime * 1000 || 0)) {
    const asset = sync().assets.get(assetId); if (!asset) return;
    const id = global.MSWProject.id('clip');
    commit('添加音频贴片', ext => {
      ext.audio_tracks ||= [{ id: 'voice-1', name: '配音', gain_db: 0, muted: false }];
      if (!ext.audio_tracks.length) ext.audio_tracks.push({ id: 'voice-1', name: '配音', gain_db: 0, muted: false });
      ext.audio_clips ||= [];
      ext.audio_clips.push(core.create(asset, ext.audio_tracks[0].id, Math.round(timeline.snap(at)), id));
    });
    host.clearSubtitleSelection(); selected.clear(); selected.add(id); timeline.refreshOverlays();
    void transport.ensure(asset);
  }
  function select(id, additive = false) {
    host.clearSubtitleSelection();
    if (!additive && !selected.has(id)) selected.clear();
    if (additive && selected.has(id)) selected.delete(id); else selected.add(id);
    timeline.pane.dataset.audioFocus = 'true'; schedulePaint();
  }
  function remove() {
    if (!selected.size) return;
    commit('删除音频贴片', ext => { ext.audio_clips = ext.audio_clips.filter(c => !selected.has(c.id)); });
    selected.clear();
  }
  function mute() {
    const shouldMute = sync().clips.some(c => selected.has(c.id) && !c.muted);
    commit(shouldMute ? '静音音频贴片' : '取消贴片静音', ext => {
      ext.audio_clips.forEach(c => { if (selected.has(c.id)) c.muted = shouldMute; });
    });
  }
  // 在播放头处把一条贴片一分为二：左段保留原 id 与起点，右段新 id 从拆分点
  // 起播（source 区间按采样率精确切分），标签沿用。
  function splitClipAtPlayhead(clip) {
    const state = sync();
    const asset = state.assets.get(clip.asset_id);
    if (!asset) return;
    const at = Math.round(transport.currentTime() ?? (host.player.currentTime * 1000 || 0));
    const finish = core.end(clip, asset);
    if (!(at > clip.start_ms + 50 && at < finish - 50)) { hint('播放头不在贴片范围内，无法拆分'); return; }
    const splitSample = clip.source_in_sample + Math.round((at - clip.start_ms) * asset.sample_rate / 1000);
    commit('拆分音频贴片', ext => {
      const target = ext.audio_clips.find(c => c.id === clip.id);
      if (!target) return;
      const right = JSON.parse(JSON.stringify(target));
      right.id = global.MSWProject.id('clip');
      right.start_ms = at;
      right.source_in_sample = splitSample;
      ext.audio_clips.push(right);
      target.source_out_sample = splitSample;
    });
    hint(`已在 ${(at / 1000).toFixed(3)}s 处拆分音频贴片`);
  }

  // === 贴片剪贴板：Ctrl+X/C/V（Ctrl+V 按「最后拷贝的对象」路由，见键盘处理） ===
  let clipClipboard = null;
  const selectedClips = () => sync().clips.filter(c => selected.has(c.id));
  function copySelectedClips(cut = false) {
    const clips = selectedClips();
    if (!clips.length) return;
    clipClipboard = JSON.parse(JSON.stringify(clips));
    global.MSW_CLIPBOARD_KIND = 'clips';
    if (cut) {
      commit(cut === 'cut' ? '剪切音频贴片' : '剪切音频贴片', ext => { ext.audio_clips = ext.audio_clips.filter(c => !selected.has(c.id)); });
      selected.clear();
    }
    hint(`${cut ? '已剪切' : '已拷贝'} ${clips.length} 个音频贴片`);
  }
  function pasteClipsFromClipboard() {
    if (!clipClipboard?.length) { hint('剪贴板里没有音频贴片'); return; }
    const state = sync();
    const copies = clipClipboard.filter(c => state.assets.has(c.asset_id));
    if (!copies.length) { hint('素材已不在当前工程，无法粘贴'); return; }
    const anchor = transport.currentTime() ?? (host.player.currentTime * 1000 || 0);
    const minStart = Math.min(...copies.map(c => c.start_ms));
    const shift = Math.max(0, Math.round(timeline.snap(anchor)) - minStart);
    const idMap = new Map(copies.map(c => [c.id, global.MSWProject.id('clip')]));
    commit('粘贴音频贴片', ext => {
      ext.audio_clips.push(...copies.map(c => ({ ...JSON.parse(JSON.stringify(c)),
        id: idMap.get(c.id), start_ms: Math.max(0, c.start_ms + shift) })));
    });
    host.clearSubtitleSelection(); selected.clear();
    for (const id of idMap.values()) selected.add(id);
    timeline.refreshOverlays();
    hint(`已粘贴 ${copies.length} 个音频贴片到 ${(anchor / 1000).toFixed(1)}s`);
  }
  function closeMenu() { clearTimeout(menuTimer); menu?.remove(); menu = null; }
  function showMenu(event, clip) {
    event.preventDefault(); event.stopPropagation(); select(clip.id); closeMenu();
    menu = document.createElement('div'); menu.className = 'ctxmenu show msw-audio-menu'; menu.setAttribute('role', 'menu');
    menu.addEventListener('mouseenter', () => clearTimeout(menuTimer));
    menu.addEventListener('mouseleave', () => { menuTimer = setTimeout(closeMenu, 280); });
    const item = (label, fn) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'item'; button.textContent = t(label);
      button.addEventListener('click', fn); menu.appendChild(button); };
    {
      const at = transport.currentTime() ?? (host.player.currentTime * 1000 || 0);
      const finishTime = core.end(clip, sync().assets.get(clip.asset_id));
      if (at > clip.start_ms + 50 && at < finishTime - 50) {
        item('在播放头处拆分', () => { splitClipAtPlayhead(clip); closeMenu(); });
      }
    }
    item(clip.muted ? '取消静音' : '静音音频贴片', mute);
    item('定位到贴片起点', () => { host.seek(clip.start_ms / 1000); closeMenu(); });
    item('恢复完整音频', () => commit('恢复完整音频', ext => { ext.audio_clips.forEach(c => {
      if (selected.has(c.id)) { c.source_in_sample = 0; c.source_out_sample = sync().assets.get(c.asset_id).sample_count; }
    }); }));
    const label = document.createElement('label'); label.className = 'msw-audio-gain'; label.textContent = `${t('贴片音量')} (dB)`;
    const input = document.createElement('input'); input.type = 'number'; input.min = '-60'; input.max = '12'; input.step = '1'; input.value = clip.gain_db;
    input.setAttribute('aria-label', t('贴片音量'));
    input.addEventListener('change', () => { const gain = Number(input.value); if (!Number.isFinite(gain) || gain < -60 || gain > 12) return;
      commit('调整贴片音量', ext => ext.audio_clips.forEach(c => { if (selected.has(c.id)) c.gain_db = gain; })); });
    label.appendChild(input); menu.appendChild(label);
    item('删除音频贴片', remove);
    if (transport.failures.has(clip.asset_id)) item('重新加载素材', () => { transport.failures.delete(clip.asset_id); void transport.ensure(sync().assets.get(clip.asset_id)); closeMenu(); });
    item('波形显示器设置', () => { closeMenu(); timeline.openWaveSettings?.(); });
    document.body.appendChild(menu);
    menu.style.left = `${Math.max(4, Math.min(event.clientX, innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(event.clientY, innerHeight - menu.offsetHeight - 4))}px`;
  }
  // 计算磁吸修正量：拖动集合的各边缘（原始位置 + delta）与静态边缘
  // （字幕块 + 未被拖动的贴片）距离小于阈值时，取最近的一条对齐。
  function magneticAdjust(delta, mode, clip, threshold) {
    const state = sync();
    const dragged = state.clips.filter(c => drag?.ids.has(c.id) && c.id !== clip.id);
    const movingEdges = [];
    const selfStart = clip.start_ms;
    const selfEnd = core.end(clip, state.assets.get(clip.asset_id));
    if (mode === 'move') {
      movingEdges.push(selfStart + delta, selfEnd + delta);
      for (const other of dragged) {
        movingEdges.push(other.start_ms + delta, core.end(other, state.assets.get(other.asset_id)) + delta);
      }
    } else if (mode === 'start') movingEdges.push(selfStart + delta);
    else movingEdges.push(selfEnd + delta);
    const statics = timeline.magneticEdges({ clipExclude: drag?.ids });
    let best = null;
    for (const moving of movingEdges) {
      for (const target of statics) {
        const distance = Math.abs(moving - target);
        if (distance > 0 && distance <= threshold && (!best || distance < best.distance)) {
          best = { distance, shift: target - moving, target };
        }
      }
    }
    // 磁吸命中时在目标时间处显示对齐参考线（与字幕块拖动同一视觉）。
    if (best) timeline.showMagnetGuide?.(best.target);
    else timeline.hideMagnetGuide?.();
    return best ? best.shift : 0;
  }

  function begin(event, clip, mode) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); closeMenu();
    select(clip.id, event.ctrlKey || event.metaKey || event.shiftKey);
    if (!selected.has(clip.id)) return;
    const point = timeline.timeAt(event.clientX, event.clientY); if (!point) return;
    const originals = extension().audio_clips, ids = mode === 'move' ? new Set(selected) : new Set([clip.id]);
    drag = { id: clip.id, mode, point, originals, ids, x: event.clientX, y: event.clientY, preview: originals, generation: host.generation, moved: false };
    const onMove = e => {
      e.stopPropagation();
      if (!drag || drag.generation !== host.generation) return finish(false);
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3 && !drag.moved) return;
      const current = timeline.timeAt(e.clientX, e.clientY);
      let delta = (current?.time ?? (drag.point.time + (e.clientX - drag.x) * drag.point.msPerPixel)) - drag.point.time;
      const edge = mode === 'end' ? core.end(clip, sync().assets.get(clip.asset_id)) : clip.start_ms;
      delta = timeline.snap(edge + delta) - edge;
      // PR 式边缘磁吸：拖动中的贴片边缘靠近字幕块 / 其他贴片边缘时自动对齐。
      const threshold = 8 * (current?.msPerPixel ?? drag.point.msPerPixel ?? 1);
      delta += magneticAdjust(delta, mode, clip, threshold);
      if (mode === 'move') delta = Math.max(delta, -Math.min(...originals.filter(c => ids.has(c.id)).map(c => c.start_ms)));
      drag.preview = originals.map(c => ids.has(c.id) ? core.edit(c, sync().assets.get(c.asset_id), mode, delta) : c);
      drag.moved = true;
      // 移动/裁切中的实时时间挂到右上常显数据行（与字幕块拖动一致），
      // 不弹浮动气泡。
      const previewSelf = drag.preview.find(c => c.id === clip.id);
      if (previewSelf) {
        const asset = sync().assets.get(previewSelf.asset_id);
        const finish = core.end(previewSelf, asset);
        timeline.setStatus?.(mode === 'move'
          ? `${t('移动贴片')} ${(previewSelf.start_ms / 1000).toFixed(3)} – ${(finish / 1000).toFixed(3)} s`
          : `${t(mode === 'start' ? '裁切起点' : '裁切终点')} ${((mode === 'start' ? previewSelf.start_ms : finish) / 1000).toFixed(3)} s`, '', { quiet: true });
      }
      schedulePaint();
    };
    const finish = apply => {
      document.removeEventListener('pointermove', onMove, true); document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onCancel, true); global.removeEventListener('blur', onCancel);
      timeline.hideMagnetGuide?.();
      timeline.refreshMediaReadout?.();
      const current = drag; drag = null;
      if (apply && current?.moved && current.generation === host.generation) {
        commit(mode === 'move' ? '移动音频贴片' : '裁剪音频贴片', ext => { ext.audio_clips = current.preview; });
      } else {
        state = null; timeline.refreshOverlays();
        if (apply && current && !current.moved && current.generation === host.generation && mode === 'move') {
          host.seek(current.point.time / 1000);
        }
      }
    };
    const onUp = e => { e.preventDefault(); e.stopPropagation(); finish(true); }, onCancel = () => finish(false);
    drag.cancel = onCancel;
    document.addEventListener('pointermove', onMove, true); document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true); global.addEventListener('blur', onCancel);
  }
  function heatBackground(clip, asset, from, to) {
    const heat = transport.heats.get(asset.id);
    if (!heat || extension().audio_settings?.heatmap === false) return '';
    const count = Math.min(96, Math.max(2, Math.ceil((to - from) / 100)));
    const gain = clip.gain_db + (sync().tracks.get(clip.track_id)?.gain_db || 0), colors = [];
    for (let i = 0; i <= count; i++) {
      const sourceMs = clip.source_in_sample / asset.sample_rate * 1000 + from - clip.start_ms + (to - from) * i / count;
      const db = heat.db[Math.min(heat.db.length - 1, Math.max(0, Math.floor(sourceMs / heat.step_ms)))] + gain;
      colors.push(`${core.dbColor(db)} ${i / count * 100}%`);
    }
    return `linear-gradient(90deg,${colors.join(',')})`;
  }
  function renderRow(row, start, end) {
    const current = sync(), has = current.clips.length > 0;
    const key = `${start}:${end}`;
    // 复用同一时间窗的 lanes 容器：拖动期间每帧的覆盖层刷新若整体重建
    // DOM，鼠标下的贴片会因节点被替换而闪烁（悬停/过渡态每帧丢失）。
    let area = row.querySelector('.msw-audio-lanes');
    if (!(area && area.dataset.key === key)) {
      if (area) { laneScroll.set(key, area.scrollTop); area.remove(); }
      area = document.createElement('div'); area.className = 'msw-audio-lanes'; area.dataset.key = key;
      area.tabIndex = 0; area.setAttribute('aria-label', t('配音轨道'));
      const inner = document.createElement('div'); inner.className = 'msw-audio-lanes-inner'; area.appendChild(inner);
      // 贴片/手柄上的指针事件仍由贴片交互接管；轨道空白处放行给波形行
      // （点击 = 定位播放头，双击 = 播放/暂停），不再被轨道层整体拦截。
      const onClip = (e) => Boolean(e.target.closest('.msw-audio-clip'));
      for (const event of ['pointerdown', 'pointermove', 'dblclick']) {
        area.addEventListener(event, (e) => { if (onClip(e)) e.stopPropagation(); });
      }
      area.addEventListener('contextmenu', (e) => { if (onClip(e)) { e.stopPropagation(); e.preventDefault(); } });
      area.addEventListener('wheel', (e) => { if (current.count > 3 && !e.ctrlKey && !e.metaKey && !e.shiftKey) e.stopPropagation(); }, { passive: true });
      area.addEventListener('scroll', () => { laneScroll.set(key, area.scrollTop); paint(); }, { passive: true });
      row.appendChild(area);
    } else {
      laneScroll.set(key, area.scrollTop);
    }
    row.classList.toggle('has-audio-clips', has);
    const visible = Math.min(3, Math.max(1, current.count)), height = visible * ROW + 6;
    row.style.setProperty('--audio-lane-space', `${has ? height + 5 : 0}px`);
    if (!has) { area.remove(); return; }
    const inner = area.querySelector('.msw-audio-lanes-inner');
    area.style.height = `${height}px`;
    area.title = t(current.count > 3 ? '重叠配音可在此区域内滚动查看' : '配音轨道：拖动移动，边缘裁剪，右键静音');
    inner.style.height = `${Math.max(1, current.count) * ROW + 6}px`;
    const overlaps = current.clips.filter((c) => c.start_ms < end && current.assets.has(c.asset_id) && core.end(c, current.assets.get(c.asset_id)) > start);
    function paint() {
      const lo = Math.max(0, Math.floor(area.scrollTop / ROW) - 1), hi = lo + visible + 2;
      // 键控复用：按 clipId 复用已有元素、只更新几何与状态类；新出现的才
      // 建节点，消失的移除——拖动每帧刷新不再重建整棵 DOM（闪烁与性能根因）。
      const existing = new Map([...inner.children].map((el) => [el.dataset.clipId, el]));
      const seen = new Set();
      for (const clip of overlaps) {
        const lane = current.lanes.get(clip.id); if (lane < lo || lane > hi) continue;
        const asset = current.assets.get(clip.asset_id), finish = core.end(clip, asset), from = Math.max(start, clip.start_ms), to = Math.min(end, finish);
        seen.add(clip.id);
        let block = existing.get(clip.id);
        if (!block) {
          block = document.createElement('div'); block.className = 'msw-audio-clip'; block.dataset.clipId = clip.id; block.tabIndex = 0;
          block.setAttribute('role', 'button'); block.setAttribute('aria-label', `${t('音频贴片')} ${clip.label}`);
          const icon = document.createElement('span'); icon.className = 'msw-audio-icon'; icon.textContent = '♪'; icon.setAttribute('aria-hidden', 'true'); block.appendChild(icon);
          const label = document.createElement('span'); label.className = 'msw-audio-clip-label'; label.textContent = clip.label || t('音频贴片'); block.appendChild(label);
          for (const mode of ['start', 'end']) {
            const handle = document.createElement('span'); handle.className = `msw-audio-handle ${mode}`; handle.dataset.mode = mode; block.appendChild(handle);
          }
          // 键控复用后监听器只绑一次：闭包里的 clip 是创建时的旧数据对象，
          // 事件发生时必须按 id 取当前数据（否则右键菜单的静音态等是过期值）。
          const liveClip = () => sync().clips.find((c) => c.id === clip.id) || clip;
          block.addEventListener('pointerdown', (e) => begin(e, liveClip(), e.target.dataset.mode || 'move'));
          block.addEventListener('contextmenu', (e) => showMenu(e, liveClip()));
          block.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); });
          inner.appendChild(block);
        }
        block.dataset.startMs = clip.start_ms; block.dataset.endMs = finish;
        const now = Math.round(transport.currentTime() ?? (host.player.currentTime * 1000 || 0));
        block.classList.toggle('active', clip.start_ms <= now && now < finish);
        block.classList.toggle('selected', selected.has(clip.id));
        const muted = clip.muted || current.tracks.get(clip.track_id)?.muted;
        block.classList.toggle('muted', muted);
        block.classList.toggle('continues-from-previous-row', clip.start_ms < start);
        block.classList.toggle('continues-to-next-row', finish > end);
        block.classList.toggle('missing', transport.failures.has(asset.id));
        block.style.left = `${(from - start) / (end - start) * 100}%`;
        block.style.width = `${(to - from) / (end - start) * 100}%`;
        block.style.top = `${lane * ROW + 3}px`;
        const background = muted ? '' : heatBackground(clip, asset, from, to);
        if (background) block.style.backgroundImage = background; else block.style.backgroundImage = '';
        block.title = `${clip.label}\n${(clip.start_ms / 1000).toFixed(3)}–${(finish / 1000).toFixed(3)} s · ${clip.gain_db} dB`
          + (transport.failures.get(asset.id) ? `\n${t(transport.failures.get(asset.id))}` : '');
        if (!transport.heats.has(asset.id) && !transport.failures.has(asset.id)) void transport.ensure(asset);
      }
      existing.forEach((el, id) => { if (!seen.has(id)) el.remove(); });
    }
    paint();
  }
  function updatePlayhead(now) {
    // Update visible blocks only; preserve DOM, heatmaps and ongoing gestures.
    for (const block of timeline.pane.querySelectorAll('.msw-audio-clip')) {
      block.classList.toggle('active', Number(block.dataset.startMs) <= now && now < Number(block.dataset.endMs));
    }
  }
  timeline.pane.addEventListener('dragover', event => {
    if (!event.dataTransfer.types.includes(MIME)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; timeline.pane.classList.add('audio-drop-target');
  });
  timeline.pane.addEventListener('dragleave', event => { if (!timeline.pane.contains(event.relatedTarget)) timeline.pane.classList.remove('audio-drop-target'); });
  timeline.pane.addEventListener('drop', event => {
    if (!event.dataTransfer.types.includes(MIME)) return;
    event.preventDefault(); event.stopPropagation(); timeline.pane.classList.remove('audio-drop-target');
    try { const value = JSON.parse(event.dataTransfer.getData(MIME));
      if (value.project_id !== extension().project_id || !sync().assets.has(value.asset_id)) throw Error('只能放入当前工程的音频素材');
      const point = timeline.timeAt(event.clientX, event.clientY); insert(value.asset_id, point?.time ?? 0);
    } catch (error) { hint(error.message); }
  }, true);
  document.addEventListener('pointerdown', event => {
    if (menu?.contains(event.target)) return;
    closeMenu();
    if (event.target.closest('.msw-audio-lanes')) return;
    if (selected.size) { selected.clear(); timeline.pane.dataset.audioFocus = ''; schedulePaint(); }
  }, true);
  document.addEventListener('keydown', event => {
    // Menus and modals own their keyboard navigation even when a clip remains
    // selected. Do not swallow Save As controls or move clips behind a dialog.
    // 守卫只针对真正的菜单栏/菜单/模态遮罩；帮助窗、设置窗、引导卡片这类
    // 工具窗此前也在守卫里（role="dialog"），焦点恰好落在其上时会吞掉贴片的
    // Ctrl+X/C/V 等全部快捷键——表现为“复制/粘贴没反应”（已修复的回归）。
    if (event.target.closest('.menubar, [role="menu"]')
        || document.querySelector('.modal-mask.show')) return;
    if (event.key === 'Escape' && (drag || menu)) { event.preventDefault(); event.stopImmediatePropagation(); drag?.cancel(); closeMenu(); return; }
    if (event.target.closest('[role="menu"], button, a')) return;
    // Ctrl+V 只按「最后拷贝的对象」路由：拷的是贴片就贴贴片、拷的是字幕就
    // 完全让位给字幕粘贴——当前选中了什么不影响路由（否则“复制字幕后顺手
    // 点了一下贴片”会把字幕粘贴劫持成贴片粘贴）。不要求有贴片选中：复制/
    // 剪切后选区即被清空，旧逻辑会让 Ctrl+V 落空，表现为“粘贴没反应”。
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'v'
        && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) && !event.target.isContentEditable) {
      if (global.MSW_CLIPBOARD_KIND === 'clips' && clipClipboard?.length) {
        event.preventDefault(); event.stopPropagation(); pasteClipsFromClipboard();
      }
      return;
    }
    if (!selected.size || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (mod && key === 's') return;
    if (mod && key === 'x') { event.preventDefault(); copySelectedClips(true); return; }
    if (mod && key === 'c') { event.preventDefault(); copySelectedClips(false); return; }
    if (mod && key === 'v') { event.preventDefault(); pasteClipsFromClipboard(); return; }
    event.stopImmediatePropagation();
    if (mod && key === 'z') { event.preventDefault(); drag?.cancel(); event.shiftKey ? host.redo() : host.undo(); }
    else if (mod && key === 'y') { event.preventDefault(); host.redo(); }
    else if (key === 'delete' || key === 'backspace') { event.preventDefault(); remove(); }
    else if (key === 'm') { event.preventDefault(); mute(); }
    else if (key === ' ') { event.preventDefault(); host.togglePlayback(); }
    else if (key === 'escape') { selected.clear(); schedulePaint(); }
    else if (key === 'arrowleft' || key === 'arrowright') {
      event.preventDefault(); let delta = (key === 'arrowleft' ? -1 : 1) * (event.shiftKey ? 100 : 10);
      delta = Math.max(delta, -Math.min(...sync().clips.filter(c => selected.has(c.id)).map(c => c.start_ms)));
      commit('移动音频贴片', ext => { ext.audio_clips = ext.audio_clips.map(c => selected.has(c.id) ? core.edit(c, sync().assets.get(c.asset_id), 'move', delta) : c); });
    }
  }, true);
  const heatToggle = document.getElementById('audio-clips-heatmap'), gapSelect = document.getElementById('audio-clips-gap-policy');
  heatToggle?.addEventListener('change', () => commit('切换贴片热力图', ext => { ext.audio_settings = { ...ext.audio_settings, heatmap: heatToggle.checked }; }));
  gapSelect?.addEventListener('change', () => commit('修改配音空隙策略', ext => { ext.audio_settings = { ...ext.audio_settings, gap_policy: gapSelect.value }; }));
  function refreshSettings() {
    if (heatToggle) heatToggle.checked = extension().audio_settings?.heatmap !== false;
    if (gapSelect) gapSelect.value = extension().audio_settings?.gap_policy || 'protect';
  }
  const api = Object.freeze({ insert, renderRow, updatePlayhead,
    selectedCount: () => selected.size,
    // 配音轨道头（波形轨道头列读取）：轨数与静音态；toggle 走 commit 可撤销。
    trackCount: () => (extension().audio_tracks || []).length,
    // 打包 lane 数（贴片重叠增多时 A 轨道头随之增加）；与 lanes 区域一致。
    laneCount: () => sync().count,
    // 当前 lane 分配快照（测试/诊断用）。
    laneSnapshot: () => Object.fromEntries(sync().lanes),
    audioTrackMuted: (index) => (extension().audio_tracks || [])[index]?.muted === true,
    toggleAudioTrackMuted: (index) => {
      const track = (extension().audio_tracks || [])[index];
      if (!track) return;
      commit(track.muted ? '启用配音轨' : '禁用配音轨', ext => {
        const target = (ext.audio_tracks || []).find(t => t.id === track.id);
        if (target) target.muted = !target.muted;
      });
    },
    // clearCues=false 供「字幕+贴片一起全选」使用：不清字幕选区。
    selectAllClips: (clearCues = true) => {
      const clips = sync().clips;
      if (clearCues) host.clearSubtitleSelection();
      selected.clear();
      for (const c of clips) selected.add(c.id);
      if (clips.length) timeline.pane.dataset.audioFocus = 'true';
      schedulePaint();
    },
    clearClipSelection: () => { if (selected.size) { selected.clear(); schedulePaint(); } },
    edges: (excludeIds) => { const state = sync(); const edges = [];
      for (const clip of state.clips) { if (excludeIds?.has(clip.id)) continue;
        edges.push(clip.start_ms, core.end(clip, state.assets.get(clip.asset_id))); }
      return edges; },
    hasAssets: () => (extension().assets || []).length > 0,
    durationMs: () => Math.ceil(sync().end), minimumRowHeight: () => sync().clips.length ? 41 + (timeline.dual() ? 40 : 24) + Math.min(3, sync().count) * ROW : 0,
    currentTimeMs: () => transport.currentTime(), togglePlayback: () => transport.toggle(), seek: ms => transport.seek(ms),
    virtualPlaying: transport.virtualPlaying, pause: transport.pause, hasAudible: () => sync().audible.length > 0,
    protectGaps: gaps => { sync(); if (gapSource !== gaps) { gapSource = gaps; protectedRanges = core.protectGaps(gaps, extension()); } return protectedRanges; },
    diagnostics: transport.diagnostics,
  });
  global.MSWE.register('audio-timeline', () => api);
  global.addEventListener('msw:audio-changed', () => { state = null; refreshSettings(); transport.reset(); });
  global.addEventListener('msw:assets-changed', () => { state = null; timeline.refresh(); });
  global.addEventListener('msw:project-changed', () => {
    drag?.cancel(); closeMenu(); selected.clear(); state = null; lastLanes = null; laneScroll.clear(); transport.clear();
    queueMicrotask(() => { refreshSettings(); timeline.refresh(); });
  });
  global.addEventListener('pagehide', () => transport.clear());
  refreshSettings(); timeline.attach(api);
})(window);
