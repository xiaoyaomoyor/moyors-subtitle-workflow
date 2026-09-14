(function (global) {
  'use strict';
  const host = global.MSWE?.resolve('processing-host'), audio = global.MSWE?.resolve('audio-timeline');
  if (!host || !audio) return;
  const el = id => document.getElementById(`audio-actions-${id}`);
  const t = value => global.MSWE_I18N?.translateText?.(value) || value;
  const core = global.MSWAudioActions;
  let batch = null, running = false;
  const terminal = new Set(['succeeded','failed','cancelled','interrupted']);
  const panel = host.createFloatingPanel({panel: el('panel'), dragHandle: el('drag'),
    anchorButton: document.querySelector('[data-menubar-item="media"] > button'), positionKey: 'msw.audio.actions.position'});
  function report(message, rows = []) {
    el('message').textContent = t(message);
    el('results').replaceChildren(...rows.map(row => {
      const li = document.createElement('li'); li.textContent = `${row.label || row.id}：${t(row.reason)}`; return li;
    }));
    el('details').hidden = !rows.length;
  }
  function refresh() {
    const clips = audio.selectedClips();
    const assets = new Map((host.data.msw?.assets || []).map(a=>[a.id,a]));
    const regenerable = clips.filter(c=>core.canRegenerate(assets.get(c.asset_id)?.generation || {})).length;
    const fillable = clips.filter(c=>{const a=assets.get(c.asset_id);return !!(a && (a.generation?.filename || a.generation?.display_text || a.source_ref?.text || c.label));}).length;
    el('count').textContent = `${t('选中贴片')}：${clips.length} · ${t('可重新生成')}：${regenerable} · ${t('可补齐字幕')}：${fillable}`;
    for (const id of ['mute', 'unmute', 'gain-apply']) el(id).disabled = !clips.length;
    el('fill').disabled = !clips.length;
    document.getElementById('audio-fill-subtitles').disabled = !clips.length;
    el('regenerate').disabled = running || (!batch && (!regenerable || !host.config?.processingUrl));
    el('regenerate').textContent = t(batch ? '继续确认本批任务' : '重新生成并替换');
    el('cancel').hidden = !batch;
    el('cancel').disabled = Boolean(batch?.cancelled);
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
  function fill() {
    panel.open();
    try {
      const clips = audio.selectedClips(); if (!clips.length) { report('请先选择音频贴片'); return; }
      const plan = host.fillAudioSubtitles(clips);
      report(`${t('已补齐')} ${plan.count} ${t('条')}，${t('跳过')} ${clips.length - plan.count} ${t('条')}`, plan.rows);
    } catch (error) { report(error.message); }
  }
  el('fill').onclick = fill; document.getElementById('audio-fill-subtitles').onclick = fill;
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
      if (value.cancelled) value.rows.forEach(row=>{ if (!row.reason) row.reason='已取消替换，新结果保留在素材库'; });
      else {
        const replacements=core.replacements(host.data.msw,value.rows);
        if (replacements.size && host.commitAudio(t('重新生成并替换音频贴片'),ext=>{
          ext.audio_clips=ext.audio_clips.map(c=>replacements.get(c.id) || c);
        })) count=replacements.size;
        for (const row of value.rows) if (!row.reason) row.reason=count && replacements.has(row.id) ? '已替换' : '未替换，新结果保留在素材库';
      }
      report(`${t('已替换')} ${count} ${t('条')}，${t('未替换')} ${value.rows.length-count} ${t('条')}`,value.rows);
      batch=null; global.dispatchEvent(new Event('msw:tts-refresh'));
    } catch (error) {
      if (current(value)) report(`${error.message}；${t('可继续确认本批任务，不会重复提交')}`);
    } finally { if (value.generation === host.generation) { running=false; refresh(); } }
  }
  el('regenerate').onclick = () => {
    if (running) return;
    if (!batch) {
      host.commitEdits();
      const plan=core.regeneration(host.data,audio.selectedClips());
      if (!plan.groups.length) { report('没有可重新生成的贴片',plan.rows); return; }
      const projectId=host.data.msw.project_id, generation=host.generation;
      batch={...plan,projectId,generation,cursor:0,cancelled:false};
      for (const group of batch.groups) group.input={kind:'tts',project_id:projectId,
        client_token:global.MSWProject.id('audio-batch'),request_key:global.MSWProject.id('request'),
        library_size:host.data.msw.assets.length,removed_asset_ids:host.data.msw.removed_asset_ids || [],
        snapshot:{project_id:projectId,entries:group.entries},provider:{recipe:group.recipe}};
    }
    void runBatch();
  };
  el('cancel').onclick = () => { if (!batch) return; batch.cancelled=true; refresh(); if (!running) void runBatch(); };
  el('close').onclick = () => panel.close();
  for (const event of ['msw:audio-selection', 'msw:audio-changed', 'msw:assets-changed']) global.addEventListener(event, refresh);
  global.addEventListener('msw:project-changed', () => { batch=null; running=false; report(''); refresh(); });
  refresh();
})(window);
