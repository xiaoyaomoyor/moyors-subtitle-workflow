// TTS task UI and project asset library. Audio bytes stay outside editor snapshots.
(function (global) {
  'use strict';
  const host = global.MSWE?.resolve('processing-host');
  if (!host?.assetLibrary) return;
  const library = host.assetLibrary;
  const el = id => document.getElementById(id) || library.querySelector(`#${id}`);
  const t = value => global.MSWE_I18N?.translateText?.(value) || value;
  const available = Boolean(host.config?.processingUrl);
  const projectId = () => global.MSWProject.ensure(host.data).project_id;
  const pageId = global.MSWProject.id('tts-page');
  const jobs = new Map(), watched = new Set(), opened = new Set(), firstReady = new Set(), missing = new Set();
  let jobCursor = 0, assetCursor = 0, timer, polling = false, pollFailures = 0;
  let configured = false, regions = [], busy = false, pending = null, scopeSignature = '', page = 0;
  let previewUrl = null, previewId = null, previewSequence = 0;
  const PAGE_SIZE = 90, DENSITY_KEY = 'msw.assets.columns';
  let density = 3;
  try { const saved = Number(localStorage.getItem(DENSITY_KEY)); if (Number.isInteger(saved) && saved >= 1 && saved <= 5) density = saved; } catch (_) {}
  const active = job => ['queued', 'running', 'cancel_requested'].includes(job.status);
  const assets = () => host.data.msw?.assets || [];
  const panel = host.createFloatingPanel({ panel: el('tts-panel'), dragHandle: el('tts-drag'),
    anchorButton: document.querySelector('[data-menubar-item="media"] > button'), positionKey: 'msw.tts.panel.position' });

  function message(text, error = false) {
    el('tts-message').textContent = t(text);
    el('tts-message').classList.toggle('is-error', error);
  }
  async function request(route, body = null, binary = false) {
    const response = await fetch(`${host.config.processingUrl}/${route}`, {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { 'X-MSW-Token': host.config.requestToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (binary && response.ok) return response.blob();
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const error = new Error(data.error || `${t('处理服务请求失败')} (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function updateScope() {
    let scope = global.MSWTts.scope(host.data, host.selection(), el('tts-target').value);
    if (scope.signature !== scopeSignature) {
      scopeSignature = scope.signature;
      el('tts-target').value = '';
      scope = global.MSWTts.scope(host.data, host.selection());
    }
    el('tts-target-field').hidden = !scope.needsChoice;
    el('tts-scope').textContent = `${t(scope.all ? '范围：全部字幕' : '范围：所选字幕')} · ${scope.sources.length} ${t('条')}`
      + (scope.needsChoice && !el('tts-target').value ? ` · ${t('请先选择主字幕或副字幕')}` : '')
      + (scope.tooLong ? ` · ${scope.tooLong} ${t('条超过 600 字符，请先拆分')}` : '');
    el('tts-start').disabled = !available || !configured || busy || (!pending && (!scope.sources.length || scope.tooLong || (scope.needsChoice && !el('tts-target').value)));
    el('tts-start').textContent = t(pending ? '确认上次提交' : '开始合成');
    return scope;
  }
  function recipe() {
    const instruct = el('tts-model').value.includes('-instruct-');
    return { provider: 'qwen', region: el('tts-region').value, model: el('tts-model').value,
      voice: el('tts-voice').value.trim(), language_type: el('tts-language').value,
      instructions: instruct ? el('tts-instructions').value.trim() : '',
      optimize_instructions: instruct && el('tts-optimize').checked };
  }
  function updateModel() { el('tts-instruct').hidden = !el('tts-model').value.includes('-instruct-'); }
  function keyState() {
    const configured = regions.find(region => region.id === el('tts-region').value)?.hasApiKey;
    el('tts-key-state').textContent = t(configured ? '此地域已有本机密钥，留空即可复用' : '请填写此地域的百炼密钥；北京和新加坡密钥不同');
    return configured;
  }
  async function loadSettings() {
    const data = await request('tts-settings');
    regions = data.regions;
    el('tts-model').replaceChildren(...data.models.map(model => new Option(model, model)));
    el('tts-language').replaceChildren(...data.languages.map(language => new Option(t(language), language)));
    const value = data.recipe;
    for (const [id, key] of [['tts-model', 'model'], ['tts-language', 'language_type'], ['tts-voice', 'voice'], ['tts-region', 'region'], ['tts-instructions', 'instructions']]) el(id).value = value[key];
    el('tts-optimize').checked = value.optimize_instructions;
    el('tts-key').value = '';
    el('tts-settings').open = !keyState();
    configured = true; updateModel(); updateScope();
  }
  function action(label, callback) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = t(label);
    button.addEventListener('click', async () => {
      button.disabled = true;
      const generation = host.generation;
      try { await callback(); }
      catch (error) { if (generation === host.generation) { message(error.message, true); el('asset-notice').textContent = error.message; } }
      finally { button.disabled = false; }
    });
    return button;
  }
  const icons = {
    play: '<path class="asset-icon-fill" d="M7 4v16l13-8z"/>',
    pause: '<path class="asset-icon-fill" d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    insert: '<path d="M3 17h18M6 20v1m6-1v1m6-1v1M12 2v11m-4-4 4 4 4-4"/>',
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
    const list = el('asset-list'); if (!list.clientWidth) return;
    const columns = Math.min(density, Math.max(1, Math.floor((list.clientWidth - 10) / 118)));
    list.style.setProperty('--asset-columns', columns);
    el('asset-density-value').value = String(columns);
  }
  const statuses = { queued: '等待处理', running: '正在合成', succeeded: '合成完成', failed: '合成失败',
    cancelled: '已取消', cancel_requested: '正在取消', interrupted: '服务中断，未自动重试' };
  function renderJobs() {
    const fragment = document.createDocumentFragment();
    for (const job of [...jobs.values()].sort((a, b) => b.created_at - a.created_at).slice(0, 20)) {
      const card = document.createElement('article'); card.className = 'msw-processing-job'; card.dataset.jobId = job.id;
      const heading = document.createElement('strong'); heading.textContent = `TTS · ${job.count} · ${job.recipe?.voice || ''}`;
      const status = document.createElement('p'); status.className = 'msw-processing-hint';
      status.textContent = `${t(statuses[job.status] || job.status)} · ${t('成功')} ${job.progress?.ready || 0} / ${job.count}`
        + (job.progress?.failed ? ` · ${t('失败')} ${job.progress.failed}` : '');
      card.append(heading, status);
      if (job.error) { const error = document.createElement('p'); error.textContent = job.error; card.append(error); }
      const actions = document.createElement('div'); actions.className = 'msw-processing-actions';
      if (active(job)) actions.append(action('取消任务', async () => {
        const generation = host.generation;
        const data = await request(`jobs/${job.id}/cancel`, { project_id: job.project_id });
        if (generation !== host.generation) return;
        jobs.set(job.id, data.job); renderJobs(); schedule(0);
      }));
      actions.append(action('查看素材', () => { host.showAssets(); el('asset-batch').value = job.id; page = 0; renderAssets(); }));
      if (!active(job) && (job.progress?.ready || 0) < job.count) {
        actions.append(action('检查未完成项', () => inspectUnfinished(job, card)));
      }
      card.append(actions); fragment.append(card);
    }
    el('tts-jobs').replaceChildren(fragment);
  }
  async function inspectUnfinished(job, card) {
    const generation = host.generation;
    const { job: detail } = await request(`jobs/${job.id}/result?project_id=${encodeURIComponent(job.project_id)}`);
    if (generation !== host.generation) return;
    card.querySelector('.msw-tts-result')?.remove();
    const saved = new Set(assets().map(a => a.source_ref.key));
    const items = new Map((detail.result?.items || []).map(row => [row.key, row]));
    const entries = detail.snapshot.entries.filter(row => !saved.has(row.key) && items.get(row.key)?.status !== 'ready');
    const view = document.createElement('div'); view.className = 'msw-tts-result';
    for (const row of entries.slice(0, 50)) {
      const text = document.createElement('p'); text.className = 'msw-asset-content';
      text.textContent = `${row.text}\n${items.get(row.key)?.error || t('尚未完成')}`; view.append(text);
    }
    const notice = document.createElement('p'); notice.textContent = `${entries.length} ${t('条未完成；重试可能再次计费，已成功的音频不会重发。')}`;
    view.append(notice);
    if (entries.length) view.append(action('重新合成未完成项', () => submit({
      snapshot: { project_id: job.project_id, entries }, retry_of: job.id, recipe: job.recipe,
    })));
    card.append(view);
  }
  async function submit(retry = null) {
    if (busy) return;
    const generation = host.generation;
    try {
      host.commitEdits(); updateScope();
      const options = retry?.recipe || recipe();
      const input = pending || { kind: 'tts', project_id: projectId(), client_token: `${pageId}.${generation}`,
        library_size: assets().length,
        request_key: global.MSWProject.id('request'), snapshot: retry?.snapshot || global.MSWTts.snapshot(host.data, host.selection(), el('tts-target').value),
        provider: { recipe: options, apiKey: options.region === el('tts-region').value ? el('tts-key').value : '' },
        ...(retry ? { retry_of: retry.retry_of } : {}) };
      pending = input; busy = true; updateScope();
      const data = await request('jobs', input);
      if (generation !== host.generation) return;
      pending = null;
      jobs.set(data.job.id, data.job); watched.add(data.job.id);
      el('tts-target').value = ''; updateScope();
      message('TTS 已开始；每条完成后可在素材库试听，关闭此窗口不会取消任务');
      el('tts-settings').open = false;
      renderJobs(); schedule(0);
    } catch (error) {
      if (generation !== host.generation) return;
      if (error.status && error.status < 500) pending = null;
      message(pending ? `${error.message}；${t('再次点击将确认上次提交，不会重复创建任务')}` : error.message, true);
    } finally { if (generation === host.generation) { busy = false; updateScope(); } }
  }
  function schedule(delay = 800) {
    clearTimeout(timer);
    if (available) timer = setTimeout(() => void poll(), delay);
  }
  async function poll() {
    if (polling || !available) return;
    polling = true;
    const generation = host.generation, id = projectId();
    try {
      const data = await request(`jobs?project_id=${encodeURIComponent(id)}&since=${jobCursor}`);
      if (generation !== host.generation) return;
      jobCursor = data.revision;
      let changed = false;
      for (const job of data.jobs.filter(job => job.kind === 'tts')) {
        if (active(job)) watched.add(job.id);
        jobs.set(job.id, job); changed = true;
      }
      const incoming = await request(`assets?project_id=${encodeURIComponent(id)}&since=${assetCursor}`);
      if (generation !== host.generation) return;
      host.addAssets(id, incoming.assets);
      assetCursor = incoming.cursor;
      if (incoming.assets.length) {
        renderAssets();
        if (incoming.assets.some(asset => watched.has(asset.job_id) && !firstReady.has(asset.job_id))) host.showAssets({ automatic: true });
        incoming.assets.forEach(asset => firstReady.add(asset.job_id));
      }
      for (const job of jobs.values()) if (!active(job) && watched.has(job.id) && !opened.has(job.id)) {
        opened.add(job.id);
        if (assets().some(asset => asset.job_id === job.id)) host.showAssets({ automatic: true });
        else message('本次没有生成音频，请检查未完成项', true);
      }
      if (changed) renderJobs();
      pollFailures = 0;
      if (incoming.more || [...jobs.values()].some(active)) schedule(incoming.more ? 0 : 800);
    } catch (error) {
      if (generation !== host.generation) return;
      message(error.message, true); pollFailures += 1;
      if (pollFailures < 6) schedule(Math.min(10000, 1000 * 2 ** pollFailures));
    } finally {
      polling = false;
      if (generation !== host.generation) schedule(0);
    }
  }
  function stopPreview() {
    previewSequence += 1;
    el('asset-audio').pause(); el('asset-audio').removeAttribute('src'); el('asset-audio').load();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; previewId = null;
    updatePreviewButtons();
  }
  async function audioBlob(asset) {
    return request(`asset-audio?project_id=${encodeURIComponent(projectId())}&asset_id=${encodeURIComponent(asset.id)}`, null, true);
  }
  async function preview(asset) {
    if (previewId === asset.id && previewUrl) {
      if (el('asset-audio').paused) { host.pauseMedia(); await el('asset-audio').play(); } else el('asset-audio').pause();
      return;
    }
    stopPreview();
    const sequence = previewSequence, generation = host.generation;
    el('asset-playing').textContent = t('正在加载音频…');
    try {
      const blob = await audioBlob(asset);
      if (sequence !== previewSequence || generation !== host.generation) return;
      previewId = asset.id; previewUrl = URL.createObjectURL(blob);
      el('asset-player').hidden = false;
      el('asset-audio').src = previewUrl; el('asset-playing').textContent = asset.generation.display_text;
      host.pauseMedia(); await el('asset-audio').play();
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
  function renderAssets() {
    const list = el('asset-list'), scroll = list.scrollTop;
    const focus = list.contains(document.activeElement) ? document.activeElement : null;
    const focusedId = focus?.closest('[data-asset-id]')?.dataset.assetId, focusedAction = focus?.dataset.assetAction;
    const all = [...assets()].sort((a, b) => b.created_at - a.created_at || a.source_ref.start - b.source_ref.start);
    const batch = el('asset-batch').value;
    const batches = new Map(all.map(a => [a.job_id, a]));
    const known = new Map([...jobs.values()].map(job => [job.id, job]));
    for (const [id, asset] of batches) if (!known.has(id)) known.set(id, { id, recipe: asset.generation, created_at: asset.created_at });
    const recent = [...known.values()].sort((a, b) => b.created_at - a.created_at).slice(0, 200);
    if (batch && known.has(batch) && !recent.some(job => job.id === batch)) recent.push(known.get(batch));
    el('asset-batch').replaceChildren(new Option(t('全部批次'), ''), ...recent.map(job =>
      new Option(`${new Date(job.created_at * 1000).toLocaleString()} · ${job.recipe?.voice || 'TTS'} · ${job.id.slice(-6)}`, job.id)));
    el('asset-batch').value = batch;
    const term = el('asset-search').value.trim().toLocaleLowerCase();
    const rows = all.filter(a => (!batch || a.job_id === batch) && (!term || `${a.generation.display_text} ${a.generation.voice} ${a.generation.model}`.toLocaleLowerCase().includes(term)));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); page = Math.min(page, pages - 1);
    el('asset-count').textContent = `${rows.length} / ${all.length} ${t('条音频')}`;
    el('asset-page').textContent = `${page + 1} / ${pages}`;
    el('asset-prev').disabled = page === 0; el('asset-next').disabled = page + 1 >= pages;
    el('asset-export-project').disabled = !available || !all.length;
    el('asset-notice').textContent = t(all.length
      ? '移动工程时请保留同目录的 .assets 文件夹；未保存工程可导出工程与 TTS 音频包。'
      : '生成的音频会显示在这里。通过「媒体 → TTS」开始配音。');
    const fragment = document.createDocumentFragment();
    for (const asset of rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)) {
      const row = document.createElement('article'); row.className = 'msw-asset-row'; row.dataset.assetId = asset.id; row.setAttribute('role', 'listitem');
      row.draggable = available;
      row.addEventListener('dragstart', event => {
        if (event.target.closest('button, input, audio')) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('application/x-msw-audio-asset', JSON.stringify({ project_id: projectId(), asset_id: asset.id }));
      });
      const content = document.createElement('div'); content.className = 'msw-asset-info';
      const text = document.createElement('p'); text.className = 'msw-asset-text msw-asset-content'; text.textContent = asset.generation.display_text; text.title = text.textContent;
      const meta = document.createElement('p'); meta.className = 'msw-asset-meta';
      const duration = asset.sample_count / asset.sample_rate, source = asset.source_ref;
      meta.textContent = `${asset.generation.voice} · ${duration.toFixed(2)} s · ${t(source.track_id == null ? '主字幕' : '副字幕')} · ${(source.start / 1000).toFixed(2)} s`;
      if (duration > (source.end - source.start) / 1000 + .1) meta.textContent += ` · ${t('长于字幕')}`;
      if (missing.has(asset.id)) { meta.textContent = `${t('素材缺失')} · ${meta.textContent}`; row.classList.add('missing'); }
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
      buttons.append(play, save, insert); row.append(content, buttons); fragment.append(row);
    }
    list.replaceChildren(fragment); updatePreviewButtons();
    if (focusedId && focusedAction) {
      const card = [...list.children].find(row => row.dataset.assetId === focusedId);
      card?.querySelector(`[data-asset-action="${focusedAction}"]`)?.focus({ preventScroll: true });
    }
    list.scrollTop = scroll;
  }
  el('tts-open').addEventListener('click', () => {
    host.commitEdits(); el('tts-target').value = ''; updateScope(); panel.open();
    if (available) {
      if (!configured) void loadSettings().catch(error => message(error.message, true));
      schedule(0);
    }
  });
  el('tts-close').addEventListener('click', () => panel.close());
  el('tts-start').addEventListener('click', () => void submit());
  el('tts-target').addEventListener('change', updateScope);
  el('tts-model').addEventListener('change', updateModel);
  el('tts-region').addEventListener('change', () => { el('tts-key').value = ''; keyState(); });
  el('tts-save-settings').addEventListener('click', async () => {
    el('tts-save-settings').disabled = true;
    try { await request('tts-settings', { recipe: recipe(), apiKey: el('tts-key').value }); await loadSettings(); message('TTS 配置已保存到本机'); }
    catch (error) { message(error.message, true); }
    finally { el('tts-save-settings').disabled = false; }
  });
  el('tts-unavailable').hidden = available; el('tts-controls').hidden = !available;
  for (const event of ['pointerup', 'keyup']) document.addEventListener(event, () => { if (panel.isOpen()) queueMicrotask(updateScope); });
  el('asset-search').addEventListener('input', () => { page = 0; el('asset-list').scrollTop = 0; renderAssets(); });
  el('asset-batch').addEventListener('change', () => { page = 0; el('asset-list').scrollTop = 0; renderAssets(); });
  el('asset-prev').addEventListener('click', () => { page = Math.max(0, page - 1); el('asset-list').scrollTop = 0; renderAssets(); });
  el('asset-next').addEventListener('click', () => { page += 1; el('asset-list').scrollTop = 0; renderAssets(); });
  el('asset-density').value = String(density);
  el('asset-density').addEventListener('input', () => {
    density = Number(el('asset-density').value); updateDensity();
    try { localStorage.setItem(DENSITY_KEY, String(density)); } catch (_) {}
  });
  new ResizeObserver(updateDensity).observe(el('asset-list'));
  for (const event of ['play', 'pause', 'ended']) el('asset-audio').addEventListener(event, updatePreviewButtons);
  el('asset-refresh').addEventListener('click', () => { missing.clear(); renderAssets(); schedule(0); });
  el('asset-export-project').addEventListener('click', async () => {
    const button = el('asset-export-project'); button.disabled = true;
    const generation = host.generation;
    try {
      const blob = await request('asset-bundle', { project_id: projectId(), project: host.exportProject() }, true);
      if (generation !== host.generation) return;
      download(blob, 'project-with-tts.zip');
      el('asset-notice').textContent = t('已导出工程与 TTS 音频；解压后打开 project.mosp。原视频仍需原媒体文件。');
    } catch (error) { if (generation === host.generation) el('asset-notice').textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.addEventListener('play', event => {
    if (event.target === el('asset-audio')) host.pauseMedia();
    else if (event.target.id === 'player') el('asset-audio').pause();
  }, true);
  global.addEventListener('msw:project-changed', () => {
    stopPreview(); jobs.clear(); watched.clear(); opened.clear(); firstReady.clear(); missing.clear();
    jobCursor = 0; assetCursor = 0; pending = null; busy = false; scopeSignature = ''; page = 0;
    el('asset-search').value = ''; el('asset-batch').value = ''; el('tts-target').value = '';
    el('asset-playing').textContent = t('选择音频试听');
    el('asset-player').hidden = true;
    queueMicrotask(() => { updateScope(); renderAssets(); renderJobs(); message(''); schedule(0); });
  });
  updateScope(); renderAssets(); if (available) schedule(0);
})(window);
