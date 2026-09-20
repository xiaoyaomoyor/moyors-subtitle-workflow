(function (global) {
  'use strict';
  const host = global.MSWE?.resolve('processing-host'), audio = global.MSWE?.resolve('audio-timeline');
  if (!host || !audio) return;
  const el = id => document.getElementById(`audio-actions-${id}`);
  const t = value => global.MSWE_I18N?.translateText?.(value) || value;
  const core = global.MSWAudioActions;
  let batch = null, running = false;
  const latestResults = new Map();
  const terminal = new Set(['succeeded','failed','cancelled','interrupted']);
  const panel = host.createFloatingPanel({panel: el('panel'), dragHandle: el('drag'),
    anchorButton: document.querySelector('[data-menubar-item="media"] > button'), positionKey: 'msw.audio.actions.position'});
  function report(message, rows = [], kind = null) {
    if(batch?.outputOnly) {
      global.dispatchEvent(new CustomEvent('msw:asset-generation',{detail:[t(message),...rows.map(row=>`${row.label||row.id}：${t(row.reason)}`)].join('\n')}));
      return;
    }
    el('message').textContent = t(message);
    // Progress updates must not reset the scroll position of completed details.
    if (!kind && latestResults.size) return;
    if (kind) latestResults.set(kind, {message, rows: rows.map(row => ({label:row.label||row.id,reason:row.reason}))});
    el('results').replaceChildren(...['补齐','替换'].filter(key=>latestResults.has(key)).map(key => {
      const result = latestResults.get(key), section = document.createElement('section');
      section.dataset.kind = key;
      const heading = document.createElement('h4'); heading.textContent = `${t(key)} · ${t(result.message)}`;
      const list = document.createElement('ul');
      list.replaceChildren(...result.rows.map(row => {
        const li = document.createElement('li'); li.textContent = `${row.label}：${t(row.reason)}`; return li;
      }));
      section.append(heading,list); return section;
    }));
    el('details').hidden = !latestResults.size;
  }
  function refresh() {
    const clips = audio.selectedClips();
    const assets = new Map((host.data.msw?.assets || []).map(a=>[a.id,a]));
    const regenerable = clips.filter(c=>core.canRegenerate(assets.get(c.asset_id)?.generation || {})).length;
    const fillable = clips.filter(c=>{const a=assets.get(c.asset_id);return !!(a && (a.generation?.filename || a.generation?.display_text || a.source_ref?.text || c.label));}).length;
    for (const id of ['mute-count','gain-count']) el(id).textContent = `${t('选中贴片')}：${clips.length}`;
    el('regenerate-count').textContent = `${t('可重新生成')}：${regenerable}`;
    el('fill-count').textContent = `${t('可补齐字幕')}：${fillable}`;
    const hasSource = Boolean(host.player.currentSrc || host.player.getAttribute('src'));
    el('source-apply').disabled = !hasSource;
    el('source-status').textContent = hasSource ? `${t('当前试听增益')}：${audio.sourceGainDb().toFixed(1)} dB` : t('请先加载媒体');
    for (const id of ['mute', 'unmute', 'gain-apply']) el(id).disabled = !clips.length;
    el('fill').disabled = !clips.length;
    el('regenerate').disabled = running || Boolean(batch?.outputOnly) || (!batch && (!regenerable || !host.config?.processingUrl));
    el('regenerate').textContent = t(batch ? '继续确认本批任务' : '重新生成并替换');
    el('cancel').hidden = !batch || Boolean(batch.outputOnly);
    el('cancel').disabled = Boolean(batch?.cancelled);
    global.dispatchEvent(new Event('msw:asset-generation'));
  }
  function mute(value) {
    const ids = new Set(audio.selectedClips().map(c => c.id)); if (!ids.size) return;
    if (host.commitAudio(t(value ? '静音贴片' : '取消贴片静音'), ext => {
      ext.audio_clips.forEach(c => { if (ids.has(c.id)) c.muted = value; });
    })) report(`${t('已处理')} ${ids.size} ${t('条贴片')}`);
  }
  el('mute').onclick = () => mute(true); el('unmute').onclick = () => mute(false);
  el('gain-apply').onclick = () => {
    try {
      const clips = audio.selectedClips(); if (!clips.length) return;
      const value = el('gain').value.trim();
      const gains = core.gains(clips, value ? Number(value) : NaN, el('gain-mode').value);
      if (host.commitAudio(t('批量修改贴片音量增益'), ext => {
        ext.audio_clips.forEach(c => { if (gains.has(c.id)) c.gain_db = gains.get(c.id); });
      })) report(`${t('已处理')} ${gains.size} ${t('条贴片')}`);
    } catch (error) { report(error.message); }
  };
  el('open').onclick = () => { refresh(); panel.open(); };
  el('source-apply').onclick = async () => {
    try {
      const value = el('source-gain').value.trim();
      const gains = core.gains([{id:'source',label:t('源音频'),gain_db:audio.sourceGainDb()}], value ? Number(value) : NaN, el('source-mode').value);
      await audio.setSourceGainDb(gains.get('source'));
      report('已调整源音频试听增益'); refresh();
    } catch (error) { report(error.message); }
  };
  function fill() {
    panel.open();
    try {
      const clips = audio.selectedClips(); if (!clips.length) { report('请先选择音频贴片'); return; }
      const plan = host.fillAudioSubtitles(clips);
      report(`${t('已补齐')} ${plan.count} ${t('条')}，${t('跳过')} ${clips.length - plan.count} ${t('条')}`, plan.rows, '补齐');
    } catch (error) { report(error.message); }
  }
  el('fill').onclick = fill;
  async function request(route, body) {
    const response = await fetch(`${host.config.processingUrl}/${route}`, {method: body ? 'POST' : 'GET', cache:'no-store',
      headers:{'X-MSW-Token':host.config.requestToken,...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {})});
    const result = await response.json().catch(()=>({}));
    if (!response.ok || !result.ok) { const error=Error(result.error || `HTTP ${response.status}`); error.status=response.status; throw error; }
    return result;
  }
  const current = value => batch === value && value.generation === host.generation && value.projectId === host.data.msw?.project_id;
  async function runBatch() {
    if (running || !batch) return;
    const value = batch; running = true; refresh();
    try {
      for (const group of value.groups) {
        if (!current(value)) return;
        if (group.done) continue;
        if (value.cancelled && !group.attempted) { group.done=true; continue; }
        if (!group.job) {
          group.attempted = true;
          try {
            const result = await request('jobs', group.input);
            group.job = result.job;
            global.dispatchEvent(new Event('msw:tts-refresh'));
          } catch (error) {
            if (error.status && error.status < 500 && error.status !== 408 && error.status !== 429) {
              group.rows.forEach(row=>row.reason=error.message); group.done=true; continue;
            }
            throw error; // Keep the exact request key for an uncertain submission.
          }
        }
        while (current(value)) {
          if (value.cancelled && !group.cancelSent) {
            await request(`jobs/${group.job.id}/cancel`, {project_id:value.projectId}); group.cancelSent=true;
          }
          const result = await request(`jobs/${group.job.id}/result?project_id=${encodeURIComponent(value.projectId)}`);
          if (!current(value)) return;
          group.job = result.job;
          if (terminal.has(group.job.status)) break;
          report(`${t(value.cancelled ? '正在取消' : '正在重新生成')} · ${value.groups.filter(g=>g.done).length + 1} / ${value.groups.length}`);
          await new Promise(resolve=>setTimeout(resolve,600));
        }
        if (!current(value)) return;
        const items = new Map((group.job.result?.items || []).map(item=>[item.key,item]));
        for (const row of group.rows) {
          const item=items.get(row.key);
          if (item?.status === 'ready') row.assetId=item.asset_id;
          else row.reason=item?.error || group.job.error || t('合成失败或已取消');
        }
        group.done=true;
      }
      // Register every completed candidate before applying. Pagination and its
      // cursor survive a failed response so resuming never repeats synthesis.
      let more=true;
      while (more && current(value)) {
        const incoming=await request(`assets?project_id=${encodeURIComponent(value.projectId)}&since=${value.cursor}`);
        if (!current(value)) return;
        host.addAssets(value.projectId,incoming.assets); value.cursor=incoming.cursor; more=incoming.more;
      }
      if (!current(value)) return;
      let count=0;
      if(value.outputOnly) {
        const ids=new Set(value.rows.filter(row=>row.assetId&&!row.reason).map(row=>row.assetId));
        if(ids.size)host.commitSubtitleAssets(t('重新生成音频素材'),ext=>{
          for(const asset of ext.assets)if(ids.has(asset.id))asset.batch_id=value.batchId;
          ext.asset_batches=ext.asset_batches||[];
          if(!ext.asset_batches.some(b=>b.id===value.batchId))ext.asset_batches.push({id:value.batchId,kind:'regenerated',created_at:Date.now(),parent_id:value.sourceAssetId});
        });
        count=ids.size;
        for(const row of value.rows)if(!row.reason)row.reason='新结果已存入素材库';
      }
      else if (value.cancelled) value.rows.forEach(row=>{ if (!row.reason) row.reason='已取消替换，新结果保留在素材库'; });
      else {
        const replacements=core.replacements(host.data.msw,value.rows);
        if (replacements.size && host.commitAudio(t('重新生成并替换音频贴片'),ext=>{
          ext.audio_clips=ext.audio_clips.map(c=>replacements.get(c.id) || c);
        })) count=replacements.size;
        for (const row of value.rows) if (!row.reason) row.reason=count && replacements.has(row.id) ? '已替换' : '未替换，新结果保留在素材库';
      }
      report(value.outputOnly?`${t('新增音频素材')} ${count} ${t('条')}`:`${t('已替换')} ${count} ${t('条')}，${t('未替换')} ${value.rows.length-count} ${t('条')}`,value.rows,'替换');
      batch=null; global.dispatchEvent(new Event('msw:tts-refresh'));
    } catch (error) {
      if (current(value)) report(`${error.message}；${t('可继续确认本批任务，不会重复提交')}`);
    } finally { if (value.generation === host.generation) { running=false; refresh(); } }
  }
  function prepare(plan,extras={}) {
    const projectId=host.data.msw.project_id,generation=host.generation;
    batch={...plan,projectId,generation,cursor:0,cancelled:false,...extras};
    for(const group of batch.groups)group.input={kind:'tts',project_id:projectId,
      client_token:global.MSWProject.id('audio-batch'),request_key:global.MSWProject.id('request'),
      library_size:host.data.msw.assets.length,removed_asset_ids:host.data.msw.removed_asset_ids||[],
      snapshot:{project_id:projectId,entries:group.entries},provider:{recipe:group.recipe}};
  }
  el('regenerate').onclick = () => {
    if (running || batch?.outputOnly) return;
    if (!batch) {
      host.commitEdits();
      const plan=core.regeneration(host.data,audio.selectedClips());
      if (!plan.groups.length) { report('没有可重新生成的贴片',plan.rows,'替换'); return; }
      prepare(plan);
    }
    void runBatch();
  };
  global.MSWE.register('asset-regenerator',()=>({get busy(){return running||Boolean(batch&&!batch.outputOnly);},
    get pendingId(){return batch?.outputOnly?batch.sourceAssetId:null;},
    async regenerate(id){
      if(running)return;
      if(batch&&(!batch.outputOnly||batch.sourceAssetId!==id))throw Error(t('请先完成正在确认的生成任务'));
      if(!batch){
        host.commitEdits();
        const asset=host.data.msw?.assets.find(a=>a.id===id);
        if(!asset)throw Error(t('素材已移除'));
        const plan=core.regeneration(host.data,[{id:asset.id,asset_id:asset.id,label:asset.generation.display_text,
          start_ms:asset.source_ref?.start||0,source_in_sample:0,source_out_sample:asset.sample_count,playback_rate:1}]);
        if(!plan.groups.length)throw Error(t(plan.rows[0]?.reason||'缺少原合成配置或属于外部音频'));
        prepare(plan,{outputOnly:true,sourceAssetId:id,batchId:global.MSWProject.id('regenerated')});
      }
      await runBatch();
    }}));
  el('cancel').onclick = () => { if (!batch) return; batch.cancelled=true; refresh(); if (!running) void runBatch(); };
  el('close').onclick = () => panel.close();
  for (const event of ['msw:audio-selection', 'msw:audio-changed', 'msw:assets-changed']) global.addEventListener(event, refresh);
  for (const event of ['loadedmetadata','emptied']) host.player.addEventListener(event, refresh);
  global.addEventListener('msw:source-gain', refresh);
  global.addEventListener('msw:project-changed', () => { batch=null; running=false; latestResults.clear(); report(''); refresh(); });
  refresh();
})(window);
