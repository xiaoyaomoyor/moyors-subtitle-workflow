// Shared audio/subtitle library; TTS only supplies task refresh and requests.
(function(global) {
  'use strict';
  global.MSWAssetLibrary = {create({host, request, jobs, schedule}) {
  const library=host.assetLibrary, el=id=>document.getElementById(id)||library.querySelector('#'+id);
  const t=value=>global.MSWE_I18N?.translateText?.(value)||value;
  const available=Boolean(host.config?.processingUrl);
  const projectId=()=>global.MSWProject.ensure(host.data).project_id;
  const assets=()=>host.data.msw?.assets||[];
  const missing=new Set();
  const selected=new Set();
  let selectionAnchor=null, visibleRows=[], editingId=null, committing=false;
  const subtitles=()=>host.data.msw?.subtitle_assets||[];
  let page=0, previewUrl=null, previewId=null, previewSequence=0, previewOwner='';
  let assetScrubbing=false, importing=false, stopImport=false;
  const PAGE_SIZE=90, DENSITY_KEY='msw.assets.columns';
  let density=3;
  try {const saved=Number(localStorage.getItem(DENSITY_KEY));if(Number.isInteger(saved)&&saved>=1&&saved<=5)density=saved;}catch(_){}
  function action(label, callback) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = t(label);
    button.addEventListener('click', async () => {
      button.disabled = true;
      const generation = host.generation;
      try { await callback(); }
      catch (error) { if (generation === host.generation) { host.flashHint(error.message, 'warning'); } }
      finally { button.disabled = false; }
    });
    return button;
  }
  const icons = {
    edit: '<path d="m4 16-1 5 5-1L21 7l-4-4zM14 6l4 4"/>',
    play: '<path class="asset-icon-fill" d="M7 4v16l13-8z"/>',
    pause: '<path class="asset-icon-fill" d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    insert: '<path d="M3 17h18M6 20v1m6-1v1m6-1v1M12 2v11m-4-4 4 4 4-4"/>',
    remove: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    sound: '<path d="M11 4 5 9H2v6h3l6 5zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    muted: '<path d="M11 4 5 9H2v6h3l6 5zm5 5 6 6m0-6-6 6"/>',
  };
  function setIcon(button, icon, label) {
    if (button.dataset.icon !== icon) {
      // Constant, local SVG paths only; subtitle text never enters HTML.
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[icon]}</svg>`;
      button.dataset.icon = icon;
    }
    const translated = t(label);
    if (button.getAttribute('aria-label') !== translated) button.setAttribute('aria-label', translated);
    if (button.title !== translated) button.title = translated;
  }
  function iconAction(label, icon, callback) {
    const button = action(label, callback); button.dataset.assetAction = icon;
    setIcon(button, icon, label); return button;
  }
  function updatePreviewButtons() {
    for (const card of el('asset-list').children) {
      const playing = card.dataset.assetId === previewId && !el('asset-audio').paused && !el('asset-audio').ended;
      card.classList.toggle('playing', playing);
      const button = card.querySelector('[data-asset-action="play"]');
      if (button) setIcon(button, playing ? 'pause' : 'play', playing ? '暂停试听' : '试听');
    }
  }
  function updateDensity() {
    el('asset-density-value').value = String(density);
    const list = el('asset-list'); if (!list.clientWidth) return;
    const columns = Math.min(density, Math.max(1, Math.floor((list.clientWidth - 10) / 118)));
    list.style.setProperty('--asset-columns', columns);
  }
  function stopPreview() {
    assetScrubbing = false;
    previewSequence += 1;
    el('asset-audio').pause(); el('asset-audio').removeAttribute('src'); el('asset-audio').load();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; previewId = null; previewOwner = '';
    el('asset-player').hidden = true;
    updatePreviewButtons();
    updateAssetTransport();
  }
  function updateAssetTransport() {
    el('asset-player').hidden = !previewUrl || el('asset-show-player')?.checked === false;
    const audio = el('asset-audio'), duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const ready = duration > 0 && !audio.error;
    const clock = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
    el('asset-seek').disabled = !ready; el('asset-seek').max = String(duration);
    if (!assetScrubbing) el('asset-seek').value = String(current);
    el('asset-clock').value = `${clock(current)} / ${clock(duration)}`;
    el('asset-seek').setAttribute('aria-valuetext', `${clock(current)} / ${clock(duration)}`);
    el('asset-play-toggle').disabled = !ready;
    setIcon(el('asset-play-toggle'), audio.paused || audio.ended ? 'play' : 'pause', audio.paused || audio.ended ? '播放试听' : '暂停试听');
    const muted = audio.muted || audio.volume === 0;
    setIcon(el('asset-mute'), muted ? 'muted' : 'sound', muted ? '取消试听静音' : '静音试听');
    el('asset-mute').setAttribute('aria-pressed', String(muted));
    el('asset-volume').value = String(audio.muted ? 0 : audio.volume);
    el('asset-rate').value = String(audio.playbackRate);
  }
  function stopReference(owner) { if (previewOwner === owner) stopPreview(); }
  async function playAssetAudio() {
    host.pauseMedia();
    try { await el('asset-audio').play(); }
    catch (error) {
      // Pausing or changing the source during play() is a normal user action.
      if (error.name !== 'AbortError') throw error;
    }
  }
  async function playReference(owner, label, load, valid = () => true) {
    stopPreview(); previewOwner = owner;
    const sequence = previewSequence, generation = host.generation;
    host.showAssets({automatic: true}); el('asset-player').hidden = el('asset-show-player').checked === false;
    el('asset-playing').textContent = t('正在加载音频…');
    try {
      const source = await load();
      if (sequence !== previewSequence || generation !== host.generation || !valid()) return;
      previewUrl = typeof source === 'string' ? source : URL.createObjectURL(source);
      el('asset-audio').src = previewUrl; el('asset-playing').textContent = label;
      await playAssetAudio();
    } catch (error) {
      if (sequence !== previewSequence || generation !== host.generation || !valid()) return;
      el('asset-playing').textContent = error.message; throw error;
    }
  }
  async function audioBlob(asset) {
    return request(`asset-audio?project_id=${encodeURIComponent(projectId())}&asset_id=${encodeURIComponent(asset.id)}`, null, true);
  }
  async function preview(asset) {
    if (previewId === asset.id && previewUrl) {
      if (el('asset-audio').paused) await playAssetAudio(); else el('asset-audio').pause();
      return;
    }
    stopPreview();
    const sequence = previewSequence, generation = host.generation;
    el('asset-playing').textContent = t('正在加载音频…');
    try {
      const blob = await audioBlob(asset);
      if (sequence !== previewSequence || generation !== host.generation) return;
      previewId = asset.id; previewUrl = URL.createObjectURL(blob);
      el('asset-player').hidden = el('asset-show-player').checked === false;
      el('asset-audio').src = previewUrl; el('asset-playing').textContent = asset.generation.display_text;
      await playAssetAudio();
    } catch (error) {
      if (sequence !== previewSequence || generation !== host.generation) return;
      if (error.status === 404) missing.add(asset.id);
      el('asset-playing').textContent = error.message; renderAssets(); throw error;
    }
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  let editTimer;
  function commitEdit() {
    clearTimeout(editTimer);
    const asset=subtitles().find(a=>a.id===editingId);
    if (committing || !asset) return;
    const text=el('cue-panel-asset-text').value.replace(/\r\n?/g,'\n');
    if (text===asset.text) return;
    committing=true;
    try { host.commitSubtitleAssets('编辑字幕素材',ext=>{
      const target=ext.subtitle_assets.find(a=>a.id===editingId);
      if(!target)return false; target.text=text; delete target.items;
    }); } finally {committing=false;}
  }
  function syncEdit() {
    const asset=subtitles().find(a=>a.id===editingId);
    if (!asset) editingId=null;
    el('current-cue-panel').classList.toggle('subtitle-asset-mode',!!asset);
    el('cue-panel-asset-text').hidden=!asset;el('cue-panel-asset-footer').hidden=!asset;
    if(asset && document.activeElement!==el('cue-panel-asset-text'))el('cue-panel-asset-text').value=asset.text;
  }
  function finishEdit({discard=false}={}) {
    if(!discard)commitEdit(); clearTimeout(editTimer);editingId=null;syncEdit();
    global.dispatchEvent(new Event('msw:asset-editing'));
  }
  function editAsset(id, focus=false) {
    if(editingId!==id) {finishEdit();host.commitEdits();editingId=id;el('cue-panel-asset-text').value=subtitles().find(a=>a.id===id)?.text||'';}
    syncEdit();host.showCueEditor();global.dispatchEvent(new Event('msw:asset-editing'));
    if(focus)el('cue-panel-asset-text').focus();
  }
  function selectAsset(asset,event) {
    if(event.shiftKey && selectionAnchor && visibleRows.some(a=>a.id===selectionAnchor)) {
      const a=visibleRows.findIndex(a=>a.id===selectionAnchor),b=visibleRows.findIndex(a=>a.id===asset.id);
      for(const item of visibleRows.slice(Math.min(a,b),Math.max(a,b)+1))selected.add(item.id);
    } else if(event.ctrlKey || event.metaKey) {
      if(selected.has(asset.id))selected.delete(asset.id);else selected.add(asset.id);
      selectionAnchor=asset.id;
    } else {selected.clear();selected.add(asset.id);selectionAnchor=asset.id;}
    if(selected.size===1 && selected.has(asset.id) && asset.kind==='subtitle')editAsset(asset.id);
    else if(!selected.size || asset.kind!=='subtitle')finishEdit();
    renderAssets();
    [...el('asset-list').children].find(r=>r.dataset.assetId===asset.id)?.focus({preventScroll:true});
  }
  async function insertSubtitles(ids, anchor=host.playheadMs()) {
    finishEdit();
    const generation=host.generation, chosen=subtitles().filter(a=>ids.includes(a.id)), tracks=host.data.multi_subtitle?.tracks||[];
    const absent=[...new Set(chosen.map(a=>a.track_id).filter(id=>id!==null && !tracks.some(t=>t.id===id)))];
    const targets={};
    if(absent.length) {
      if(!tracks.length)throw Error(t('请先创建副字幕轨，再放入副字幕素材'));
      for(const id of absent) {
        const target=await chooseTrack(tracks);
        if(!target || generation!==host.generation)return;
        targets[id]=target;
      }
    }
    const result=host.insertSubtitleAssets(ids,anchor,targets);
    const skipped=result.rows.filter(r=>r.reason);
    el('asset-import-status').hidden=false;el('asset-import-stop').hidden=true;
    el('asset-import-message').textContent=`${t('已放入')} ${result.count} ${t('条字幕')}`
      + (skipped.length ? '\n'+skipped.map(r=>`${r.text.slice(0,50)}：${t(r.reason)}`).join('\n') : '');
    host.flashHint(`${t('已放入')} ${result.count} ${t('条字幕')}`,skipped.length?'warning':'success');
  }
  function chooseTrack(tracks) {
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='msw-asset-track-dialog';
      const form=document.createElement('form');form.method='dialog';
      const label=document.createElement('label');label.textContent=t('选择目标副字幕轨');
      const select=document.createElement('select');select.setAttribute('aria-label',t('选择目标副字幕轨'));
      for(const track of tracks)select.add(new Option(track.name||track.id,track.id));
      const cancel=document.createElement('button');cancel.value='cancel';cancel.textContent=t('取消');
      const accept=document.createElement('button');accept.value='ok';accept.textContent=t('放入时间轴');
      label.append(select);form.append(label,cancel,accept);dialog.append(form);document.body.append(dialog);
      dialog.addEventListener('close',()=>{const value=dialog.returnValue==='ok'?select.value:null;dialog.remove();resolve(value);},{once:true});dialog.showModal();
    });
  }
  el('cue-panel-asset-text').addEventListener('input',()=>{clearTimeout(editTimer);editTimer=setTimeout(commitEdit,400);});
  el('cue-panel-asset-text').addEventListener('blur',commitEdit);
  el('cue-panel-asset-done').addEventListener('click',()=>finishEdit());
  el('asset-insert-selected').addEventListener('click',()=>void insertSubtitles([...selected]).catch(e=>host.flashHint(e.message,'warning')));
  function renderAssets() {
    const list = el('asset-list'), scroll = list.scrollTop;
    const focus = list.contains(document.activeElement) ? document.activeElement : null;
    const focusedId = focus?.closest('[data-asset-id]')?.dataset.assetId, focusedAction = focus?.dataset.assetAction;
    const type = el('asset-type').value;
    const all = [...assets(), ...subtitles()].filter(a => !type || a.kind === type);
    const batchId = a => a.batch_id || a.job_id;
    const batchRecords = new Map(global.MSWAssets.batches(host.data.msw || {}).map(b => [b.id,b]));
    all.sort((a,b) => (batchRecords.get(batchId(b))?.created_at || 0)-(batchRecords.get(batchId(a))?.created_at || 0)
      || batchId(a).localeCompare(batchId(b)) || (a.original_start ?? a.source_ref.start)-(b.original_start ?? b.source_ref.start));
    const sourceStatuses = global.MSWAsr?.assetStatuses(host.data) || new Map();
    let batch = el('asset-batch').value;
    const batchIds = new Set(all.map(batchId));
    if (batch && !batchIds.has(batch)) batch = '';
    const labels = {copy:'复制字幕',asr:'ASR',tts:'TTS',imported:'外部音频',regenerated:'重新生成'};
    el('asset-batch').replaceChildren(new Option(t('全部批次'), ''), ...[...batchIds].map(id => {
      const record=batchRecords.get(id);
      return new Option(`${new Date(record?.created_at || 0).toLocaleString()} · ${t(labels[record?.kind] || '素材')} · ${id.slice(-6)}`,id);
    }));
    el('asset-batch').value = batch;
    const term = el('asset-search').value.trim().toLocaleLowerCase();
    const rows = all.filter(a => (!batch || batchId(a) === batch) && (!term || (a.kind === 'subtitle' ? a.text : `${a.generation.display_text} ${a.generation.voice} ${a.generation.model} ${a.generation.filename || ''}`).toLocaleLowerCase().includes(term)));
    visibleRows = rows;
    const liveIds = new Set([...assets(),...subtitles()].map(a => a.id));
    for (const id of selected) if (!liveIds.has(id)) selected.delete(id);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); page = Math.min(page, pages - 1);
    el('asset-count').textContent = `${rows.length} / ${all.length} ${t(type === 'audio' ? '条音频' : type === 'subtitle' ? '条字幕' : '条素材')}`
      + (selected.size ? ` · ${t('已选')} ${selected.size}` : '');
    el('asset-insert-selected').hidden = !selected.size || [...selected].some(id => !subtitles().some(a => a.id === id));
    el('asset-page').textContent = `${page + 1} / ${pages}`;
    el('asset-prev').disabled = page === 0; el('asset-next').disabled = page + 1 >= pages;
    el('asset-export-project').disabled = !available || !all.length;
    el('asset-notice').textContent = t(assets().length
      ? '移动工程时请保留同目录的 .assets 文件夹；未保存工程可导出工程与音频素材包。'
      : '字幕素材随工程保存。');
    const fragment = document.createDocumentFragment();
    for (const asset of rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)) {
      const row = document.createElement('article'); row.className = 'msw-asset-row'; row.dataset.assetId = asset.id; row.dataset.kind = asset.kind;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected',String(selected.has(asset.id))); row.tabIndex=0;
      row.classList.toggle('selected',selected.has(asset.id)); row.draggable = asset.kind === 'subtitle' || available;
      row.addEventListener('click', event => {if(!event.target.closest('button,input,audio')) selectAsset(asset,event);});
      row.addEventListener('keydown',event=>{if(event.target===row && [' ','Enter'].includes(event.key)){event.preventDefault();selectAsset(asset,event);}});
      row.addEventListener('dragstart', event => {
        if (event.target.closest('button, input, audio')) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = 'copy';
        if (asset.kind === 'subtitle') event.dataTransfer.setData('application/x-msw-subtitle-assets', JSON.stringify({project_id:projectId(),ids:selected.has(asset.id) ? subtitles().filter(a=>selected.has(a.id)).map(a=>a.id) : [asset.id]}));
        else event.dataTransfer.setData('application/x-msw-audio-asset', JSON.stringify({ project_id: projectId(), asset_id: asset.id }));
      });
      if (asset.kind === 'subtitle') {
        const content=document.createElement('div');content.className='msw-asset-info';
        const text=document.createElement('p');text.className='msw-asset-text msw-asset-content';text.textContent=asset.text;text.title=asset.text;
        const meta=document.createElement('p');meta.className='msw-asset-meta';
        meta.textContent=`${t(asset.track_id === null ? '主字幕素材' : '副字幕素材')} · ${((asset.end-asset.start)/1000).toFixed(2)} s`;
        if (asset.color) {row.style.setProperty('--asset-mark',asset.color.value);row.classList.add('marked');}
        content.append(text,meta);
        const buttons=document.createElement('div');buttons.className='msw-asset-actions';
        buttons.append(iconAction('编辑字幕素材','edit',()=>{selected.clear();selected.add(asset.id);editAsset(asset.id,true);renderAssets();}),
          iconAction('放入时间轴','insert',()=>insertSubtitles([asset.id])),iconAction('删除素材','remove',()=>{
            finishEdit();host.commitSubtitleAssets('删除字幕素材',ext=>{ext.subtitle_assets=ext.subtitle_assets.filter(a=>a.id!==asset.id);});
          }));
        row.append(content,buttons);fragment.append(row);continue;
      }
      const content = document.createElement('div'); content.className = 'msw-asset-info';
      const text = document.createElement('p'); text.className = 'msw-asset-text msw-asset-content'; text.textContent = asset.generation.display_text; text.title = text.textContent;
      const meta = document.createElement('p'); meta.className = 'msw-asset-meta';
      const duration = asset.sample_count / asset.sample_rate, source = asset.source_ref;
      meta.textContent = `${asset.generation.voice} · ${duration.toFixed(2)} s · ${t(source.track_id == null ? '主字幕' : '副字幕')} · ${(source.start / 1000).toFixed(2)} s`;
      if (asset.generation.provider === 'imported') meta.textContent = `${t('外部音频')} · ${duration.toFixed(2)} s · ${asset.generation.filename || ''}`;
      else if (source.kind === 'editor_text') meta.textContent = `${asset.generation.voice} · ${duration.toFixed(2)} s · ${t('文本配音')} · ${(source.start / 1000).toFixed(2)} s`;
      else if (duration > (source.end - source.start) / 1000 + .1) meta.textContent += ` · ${t('长于字幕')}`;
      if (missing.has(asset.id)) { meta.textContent = `${t('素材缺失')} · ${meta.textContent}`; row.classList.add('missing'); }
      if (sourceStatuses.has(asset.id)) { meta.textContent += ` · ${t(sourceStatuses.get(asset.id))}`; row.classList.add('msw-source-stale'); }
      meta.title = meta.textContent;
      content.append(text, meta);
      const buttons = document.createElement('div'); buttons.className = 'msw-asset-actions';
      const play = iconAction('试听', 'play', () => preview(asset)); play.disabled = !available;
      const save = iconAction('下载 WAV', 'download', async () => {
        const generation = host.generation, blob = await audioBlob(asset);
        if (generation === host.generation) download(blob, `${asset.id}.wav`);
      }); save.disabled = !available;
      const insert = iconAction('放入时间轴', 'insert', () => global.MSWE?.resolve('audio-timeline')?.insert(asset.id));
      insert.disabled = !available;
      const remove = iconAction('删除素材', 'remove', () => {
        const count = (host.data.msw?.audio_clips || []).filter(clip => clip.asset_id === asset.id).length;
        if (count && !global.confirm(t(`此素材已被 ${count} 个音频贴片使用。删除素材并同时移除这些贴片？可撤销。`))) return;
        if (previewId === asset.id || !previewId) stopPreview();
        if (host.removeAsset(asset.id)) host.flashHint(t('素材已移除，可撤销；原文件保留'), 'success');
      });
      buttons.append(play, save, insert, remove); row.append(content, buttons); fragment.append(row);
    }
    list.replaceChildren(fragment); updatePreviewButtons();
    if (focusedId) {
      const card = [...list.children].find(row => row.dataset.assetId === focusedId);
      const target=focusedAction ? card?.querySelector(`[data-asset-action="${focusedAction}"]`) : card;
      target?.focus({ preventScroll: true });
    }
    list.scrollTop = scroll;
    syncEdit();
  }
  function filterChanged() { finishEdit(); selected.clear(); selectionAnchor=null; page=0;el('asset-list').scrollTop=0;renderAssets(); }
  el('asset-search').addEventListener('input', filterChanged);
  el('asset-batch').addEventListener('change', filterChanged);
  el('asset-type').addEventListener('change', filterChanged);
  el('asset-prev').addEventListener('click', () => { page = Math.max(0, page - 1); el('asset-list').scrollTop = 0; renderAssets(); });
  el('asset-next').addEventListener('click', () => { page += 1; el('asset-list').scrollTop = 0; renderAssets(); });
  el('asset-density').value = String(density);
  el('asset-density').addEventListener('input', () => {
    density = Number(el('asset-density').value); updateDensity();
    try { localStorage.setItem(DENSITY_KEY, String(density)); } catch (_) {}
  });
  new ResizeObserver(updateDensity).observe(el('asset-list'));
  global.addEventListener('msw:assets-changed', () => {
    if (previewId && !assets().some(asset => asset.id === previewId)) stopPreview();
    renderAssets();
  });
  global.addEventListener('msw:subtitles-changed', renderAssets);
  for (const event of ['play', 'pause', 'ended']) el('asset-audio').addEventListener(event, updatePreviewButtons);
  for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'emptied', 'volumechange', 'ratechange', 'error']) el('asset-audio').addEventListener(event, updateAssetTransport);
  el('asset-play-toggle').addEventListener('click', async () => {
    const audio = el('asset-audio');
    if (!audio.paused && !audio.ended) { audio.pause(); return; }
    try { await playAssetAudio(); }
    catch (error) { el('asset-playing').textContent = error.message; }
  });
  el('asset-seek').addEventListener('pointerdown', () => { assetScrubbing = true; });
  for (const event of ['pointerup', 'pointercancel']) document.addEventListener(event, () => { if (assetScrubbing) { assetScrubbing = false; updateAssetTransport(); } });
  el('asset-seek').addEventListener('input', () => {
    const audio = el('asset-audio');
    if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Math.max(0, Math.min(audio.duration, Number(el('asset-seek').value)));
    updateAssetTransport();
  });
  el('asset-mute').addEventListener('click', () => {
    const audio = el('asset-audio');
    if (audio.muted || !audio.volume) { audio.muted = false; if (!audio.volume) audio.volume = 1; }
    else audio.muted = true;
    updateAssetTransport();
  });
  el('asset-volume').addEventListener('input', () => { el('asset-audio').volume = Number(el('asset-volume').value); el('asset-audio').muted = false; });
  el('asset-rate').addEventListener('change', () => { el('asset-audio').playbackRate = Number(el('asset-rate').value); });
  updateAssetTransport();
  el('asset-audio').addEventListener('error', () => {
    if (previewOwner && el('asset-audio').getAttribute('src')) el('asset-playing').textContent = t('试听音频无法加载，请检查连接后重试');
  });
  el('asset-refresh').addEventListener('click', () => { missing.clear(); renderAssets(); schedule(0); });
  el('asset-import').disabled = !available;
  el('asset-import').addEventListener('click', () => { if (!importing) el('asset-import-file').click(); });
  el('asset-import-stop').addEventListener('click', () => { stopImport = true; el('asset-import-stop').disabled = true; });
  el('asset-import-file').addEventListener('change', async event => {
    const files = [...event.target.files]; event.target.value = '';
    if (importing || !files.length) return;
    if (files.length > 100) { host.flashHint(t('每次最多导入 100 个音频文件'), 'warning'); return; }
    importing = true; stopImport = false; el('asset-import').disabled = true;
    const generation = host.generation, id = projectId(), importBatch=global.MSWProject.id('import');
    el('asset-import-status').hidden = false; el('asset-import-stop').hidden = false; el('asset-import-stop').disabled = false;
    let success = 0;
    const failures = [];
    try {
      for (const [index, file] of files.entries()) {
        if (stopImport || generation !== host.generation) break;
        el('asset-import-message').textContent = `${t('正在导入')} ${index + 1}/${files.length} · ${file.name}`;
        try {
          if (!/\.(wav|mp3|flac|m4a|aac|ogg|opus)$/i.test(file.name)) throw new Error(t('不支持的音频格式'));
          if (!file.size || file.size > 32 * 1024 * 1024) throw new Error(t('单个导入文件须为 1 字节至 32 MiB'));
          const encoded = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error(t('无法读取音频文件'))); reader.readAsDataURL(file);
          });
          if (generation !== host.generation || stopImport) break;
          const result = await request('asset-import', {project_id: id, request_key: global.MSWProject.id('upload'),
            filename: file.name, audio_base64: encoded, library_size: assets().length, removed_asset_ids: host.data.msw?.removed_asset_ids || []});
          if (generation !== host.generation) break;
          host.addAssets(id, [{...result.asset,batch_id:importBatch}]); success++; renderAssets();
        } catch (error) { failures.push(`${file.name}：${error.message}`); }
      }
    } finally {
      importing = false; el('asset-import').disabled = !available; el('asset-import-stop').hidden = true;
      if (generation === host.generation) {
        el('asset-import-message').textContent = `${t('已导入')} ${success}/${files.length}`
          + (stopImport ? ` · ${t('已停止后续导入')}` : '') + (failures.length ? `\n${failures.join('\n')}` : '');
        if (success) { host.showAssets({automatic: true}); schedule(0); }
      }
    }
  });
  el('asset-export-project').addEventListener('click', async () => {
    const button = el('asset-export-project'); button.disabled = true;
    const generation = host.generation;
    try {
      const blob = await request('asset-bundle', { project_id: projectId(), project: host.exportProject() }, true);
      if (generation !== host.generation) return;
      download(blob, 'project-with-assets.zip');
      host.flashHint(t('已导出工程与音频素材包；解压后打开 project.mosp。'), 'success');
    } catch (error) { if (generation === host.generation) host.flashHint(error.message, 'warning'); }
    finally { button.disabled = false; }
  });
  document.addEventListener('play', event => {
    if (event.target === el('asset-audio')) host.pauseMedia();
    else if (event.target.id === 'player') {
      if (previewOwner && !previewUrl) stopPreview();
      else el('asset-audio').pause();
    }
  }, true);

  global.addEventListener('msw:project-changed',()=>{
    finishEdit({discard:true});selected.clear();selectionAnchor=null;el('asset-type').value='';
    stopImport=true;el('asset-import-status').hidden=true;stopPreview();missing.clear();page=0;
    el('asset-search').value='';el('asset-batch').value='';
    el('asset-playing').textContent=t('选择音频试听');queueMicrotask(renderAssets);
  });
  el('asset-show-player').addEventListener('change',()=>{
    try {localStorage.setItem('msw.assets.showPlayer',String(el('asset-show-player').checked));}catch(_){}
    updateAssetTransport();
  });
  try {el('asset-show-player').checked=localStorage.getItem('msw.assets.showPlayer')!=='false';}catch(_){}
  const timeline=host.timeline, MIME='application/x-msw-subtitle-assets';
  timeline?.pane.addEventListener('dragover',event=>{
    if(!event.dataTransfer.types.includes(MIME))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';
  },true);
  timeline?.pane.addEventListener('drop',event=>{
    if(!event.dataTransfer.types.includes(MIME))return;event.preventDefault();event.stopPropagation();
    try {const value=JSON.parse(event.dataTransfer.getData(MIME));
      if(value.project_id!==projectId() || !Array.isArray(value.ids) || !value.ids.every(id=>subtitles().some(a=>a.id===id)))throw Error(t('只能放入当前工程的字幕素材'));
      const point=timeline.timeAt(event.clientX,event.clientY);if(!point)return;
      void insertSubtitles(value.ids,point.time).catch(e=>host.flashHint(e.message,'warning'));
    }catch(e){host.flashHint(e.message,'warning');}
  },true);
  const api={renderAssets,playReference,stopReference,commitEdit,finishEdit,get editing(){return !!editingId;},
    selectedIds:()=>[...selected],showBatch(id){finishEdit();selected.clear();el('asset-type').value='';renderAssets();el('asset-batch').value=id;page=0;renderAssets();}};
  global.MSWE.register('asset-library',()=>api);
  renderAssets();
  return api;
  }};
})(window);
