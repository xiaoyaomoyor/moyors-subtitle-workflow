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
  let settingsPromise = null, savingSettings = false;
  let draftActive = false, draftInitialized = false;
  const isText = () => el('tts-target').value === 'editor_text';
  let runtime = {state: 'idle', runtime_path: ''}, runtimeTimer, runtimeRequest = false;
  const isYukkuri = () => el('tts-engine').value === 'yukkuri';
  const isIndex = () => el('tts-engine').value === 'indextts';
  let previewUrl = null, previewId = null, previewSequence = 0, previewOwner = '';
  let importing = false, stopImport = false, yukkuriPreviewBusy = false;
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
  const qwenVoices = global.MSWQwenVoices.create({el, t, request, recipe: qwenRecipe, updateScope,
    playReference, stopReference, generation: () => host.generation});
  const indexTts = global.MSWIndexTts.create({el, t, request, updateScope,
    playReference, stopReference, generation: () => host.generation});
  function syncDraft() {
    const next = available && isText() && panel.isOpen();
    if (next === draftActive) return;
    if (next) {
      host.commitEdits();
      if (!draftInitialized) { el('cue-panel-tts-text').value = host.editorText(); draftInitialized = true; }
      host.showCueEditor();
    }
    draftActive = next;
    el('current-cue-panel').classList.toggle('tts-draft-mode', next);
    el('cue-panel-tts-text').hidden = !next; el('cue-panel-tts-footer').hidden = !next;
    if (next) {
      el('cue-panel-tts-text').focus({preventScroll: true});
      requestAnimationFrame(() => {
        if (!draftActive || !panel.isOpen()) return;
        const input = el('cue-panel-tts-text').getBoundingClientRect(), box = el('tts-panel').getBoundingClientRect();
        if (box.left >= input.right || box.right <= input.left || box.bottom <= input.top || box.top >= input.bottom) return;
        const left = input.right + box.width + 16 <= innerWidth ? input.right + 8 : input.left - box.width - 8 >= 6 ? input.left - box.width - 8 : null;
        if (left !== null) { el('tts-panel').style.left = `${left}px`; el('tts-panel').style.right = 'auto'; }
      });
    }
  }
  function updateScope() {
    const scope = isText() ? {signature: 'editor_text', sources: el('cue-panel-tts-text').value.trim() ? [{}] : [],
      tooLong: [...el('cue-panel-tts-text').value].length > 600 ? 1 : 0} : global.MSWTts.scope(host.data, host.selection(), el('tts-target').value);
    if (scope.signature !== scopeSignature) {
      scopeSignature = scope.signature;
      el('tts-yukkuri-pronunciation').value = '';
      el('tts-index-pronunciation').value = '';
    }
    el('tts-scope').textContent = (isText() ? t('范围：独立配音草稿 · 不修改字幕')
      : `${t(scope.all ? '范围：全部字幕' : '范围：所选字幕')} · ${scope.sources.length} ${t('条')}`
        + (scope.linked ? ` · ${t('连锁字幕按操作对象合成，独立字幕保留原选区')}` : ''))
      + (scope.tooLong ? ` · ${scope.tooLong} ${t('条超过 600 字符，请先拆分')}` : '');
    el('cue-panel-tts-count').textContent = `${[...el('cue-panel-tts-text').value].length} / 600`;
    el('tts-yukkuri-pronunciation-field').hidden = isText() || scope.sources.length !== 1;
    el('tts-index-pronunciation-field').hidden = el('tts-yukkuri-pronunciation-field').hidden;
    el('tts-start').disabled = !available || !configured || busy || (!pending && (
      (isYukkuri() && (!runtime.runtime_path || runtime.state === 'working' || runtimeRequest))
      || (isIndex() && !indexTts.ready())
      || (!isYukkuri() && !isIndex() && (!el('tts-voice').value.trim() || (!keyState() && !el('tts-key').value.trim())))
      || !scope.sources.length || scope.tooLong || (scope.needsChoice && !el('tts-target').value)));
    el('tts-start').textContent = t(pending ? '确认上次提交' : '开始合成');
    for (const id of ['tts-save-settings', 'tts-environment-save']) el(id).disabled = !available || !configured || savingSettings || indexTts.isBusy();
    environmentNotice();
    return scope;
  }
  function recipe() {
    return recipeFor(el('tts-engine').value);
  }
  function recipeFor(engine) {
    if (engine === 'indextts') return indexTts.recipe();
    if (engine === 'yukkuri') return {provider: 'yukkuri', model: 'aquestalk1', voice: el('tts-yukkuri-voice').value,
      language_type: el('tts-yukkuri-language').value, speed: Number(el('tts-yukkuri-speed').value)};
    return qwenRecipe();
  }
  function qwenRecipe() {
    const instruct = el('tts-model').value.includes('-instruct-');
    return { provider: 'qwen', region: el('tts-region').value, model_type: el('tts-model-type').value, model: el('tts-model').value,
      voice: el('tts-voice').value.trim(), language_type: el('tts-language').value,
      instructions: instruct ? el('tts-instructions').value.trim() : '',
      optimize_instructions: instruct && el('tts-optimize').checked };
  }
  function updateEngine() {
    stopReference('yukkuri');
    el('tts-qwen-fields').hidden = isYukkuri() || isIndex();
    el('tts-yukkuri-fields').hidden = !isYukkuri();
    el('tts-index-fields').hidden = !isIndex();
    if (!isIndex() && !el('editor-settings-modal').classList.contains('show')) indexTts.invalidate();
    else indexTts.stopPreview();
    updateScope();
    if (isYukkuri() && runtime.state === 'idle' && runtime.runtime_path) void runtimeAction('check');
    if (configured && isIndex() && !indexTts.connected()) void indexTts.check();
  }
  function renderRuntime(value) {
    runtime = value;
    const working = value.state === 'working';
    el('tts-yukkuri-runtime-status').textContent = t(value.message || '尚未检测本机资源');
    el('tts-yukkuri-runtime-status').classList.toggle('is-error', value.state === 'failed');
    el('tts-yukkuri-install').disabled = working || runtimeRequest;
    el('tts-yukkuri-check').disabled = working || runtimeRequest;
    el('tts-yukkuri-cancel').hidden = !working;
    el('tts-yukkuri-preview').disabled = value.state !== 'ready' || yukkuriPreviewBusy;
    const progress = el('tts-yukkuri-progress'); progress.hidden = !working;
    if (value.total) { progress.max = value.total; progress.value = value.current; } else progress.removeAttribute('value');
    if (value.state === 'ready') el('tts-yukkuri-directory').value = value.runtime_path;
    if (!value.runtime_path || value.state === 'failed') el('tts-yukkuri-resources').open = true;
    clearTimeout(runtimeTimer);
    if (working) runtimeTimer = setTimeout(() => void pollRuntime(), 800);
    updateScope();
  }
  async function pollRuntime() {
    try { const data = await request('yukkuri-runtime'); renderRuntime(data.runtime); }
    catch (error) {
      el('tts-yukkuri-runtime-status').textContent = error.message;
      if (panel.isOpen()) runtimeTimer = setTimeout(() => void pollRuntime(), 3000);
    }
  }
  async function runtimeAction(action) {
    if (runtimeRequest) return;
    runtimeRequest = true; renderRuntime(runtime);
    try {
      const data = await request('yukkuri-runtime', {action, directory: el('tts-yukkuri-directory').value.trim()});
      runtimeRequest = false; renderRuntime(data.runtime);
    } catch (error) { el('tts-yukkuri-runtime-status').textContent = error.message; }
    finally {
      runtimeRequest = false;
      el('tts-yukkuri-install').disabled = runtime.state === 'working';
      el('tts-yukkuri-check').disabled = runtime.state === 'working'; updateScope();
    }
  }
  function keyState() {
    const configured = regions.find(region => region.id === el('tts-region').value)?.hasApiKey;
    el('tts-key-state').textContent = t(configured ? '此地域已有本机密钥，留空即可复用' : '请填写此地域的百炼密钥；北京和新加坡密钥不同');
    return configured;
  }
  async function loadSettings(preserve = false) {
    const previous = preserve && configured ? {engine: el('tts-engine').value, qwen: qwenRecipe(),
      yukkuri: recipeFor('yukkuri'), index: indexTts.recipe(), key: el('tts-key').value} : null;
    const data = await request('tts-settings');
    if (!data.modelTypes || !data.systemVoices || data.workspace_version !== 2) {
      configured = false; updateScope();
      throw new Error(t('本机 TTS 服务仍是旧版本，请重启编辑器服务后刷新页面'));
    }
    regions = data.regions;
    el('tts-language').replaceChildren(...data.languages.map(language => new Option(t(language), language)));
    const value = previous?.qwen || data.recipe;
    for (const [id, key] of [['tts-language', 'language_type'], ['tts-region', 'region'], ['tts-instructions', 'instructions']]) el(id).value = value[key];
    el('tts-optimize').checked = value.optimize_instructions;
    el('tts-key').value = previous?.key || '';
    el('tts-settings').open = !keyState();
    el('tts-engine').value = previous?.engine || data.engine || 'qwen';
    if (data.yukkuri) {
      const local = previous?.yukkuri || data.yukkuri.recipe;
      el('tts-yukkuri-voice').value = local.voice; el('tts-yukkuri-language').value = local.language_type;
      el('tts-yukkuri-speed').value = String(local.speed); el('tts-yukkuri-speed-value').value = String(local.speed);
      el('tts-yukkuri-directory').value = data.yukkuri.runtime_path;
      renderRuntime(data.yukkuri);
    }
    configured = true; qwenVoices.configure({...data, recipe: value});
    indexTts.configure({...data.index_tts, ...(previous ? {recipe: previous.index} : {})}); updateEngine();
  }
  function ensureSettings() {
    if (configured) return Promise.resolve();
    if (!settingsPromise) settingsPromise = loadSettings().finally(() => { settingsPromise = null; });
    return settingsPromise;
  }
  function environmentNotice() {
    let text = '';
    if (!configured) text = '正在读取本机 TTS 配置…';
    else if (isIndex()) text = indexTts.problem();
    else if (isYukkuri() && (!runtime.runtime_path || runtime.state === 'failed')) text = '油库里资源未就绪，请前往环境配置安装或检测。';
    else if (!isYukkuri() && !isIndex() && !keyState() && !el('tts-key').value.trim()) text = '百炼密钥尚未配置，请前往环境配置填写。';
    el('tts-environment-notice').textContent = t(text); el('tts-environment-notice').hidden = !text;
    el('tts-environment-reminder').hidden = !text || !configured;
  }
  async function environmentView() {
    const engine = el('tts-environment-engine').value;
    for (const id of ['qwen', 'yukkuri', 'indextts']) el('tts-environment-' + id).hidden = engine !== id;
    if (!available) return;
    try {
      await ensureSettings();
      if (el('tts-environment-engine').value !== engine) return;
      if (engine === 'qwen') qwenVoices.management();
      else if (engine === 'yukkuri') await pollRuntime();
    } catch (error) { el('tts-environment-message').textContent = error.message; }
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
    remove: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
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
  const statuses = { queued: '等待处理', running: '正在合成', succeeded: '合成完成', failed: '合成失败',
    cancelled: '已取消', cancel_requested: '正在取消', interrupted: '服务中断，未自动重试' };
  function renderJobs() {
    const scroll = el('tts-jobs').scrollTop;
    const fragment = document.createDocumentFragment();
    for (const job of [...jobs.values()].sort((a, b) => b.created_at - a.created_at)) {
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
    el('tts-jobs').scrollTop = scroll;
    el('tts-history-count').textContent = `(${jobs.size})`;
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
    const notice = document.createElement('p'); notice.textContent = `${entries.length} ${t(['yukkuri', 'indextts'].includes(job.recipe?.provider)
      ? '条未完成；使用本机资源重试，已成功的音频不会重发。' : '条未完成；重试可能再次计费，已成功的音频不会重发。')}`;
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
        removed_asset_ids: host.data.msw?.removed_asset_ids || [],
        request_key: global.MSWProject.id('request'), snapshot: retry?.snapshot || (isText()
          ? global.MSWTts.textSnapshot(host.data, el('cue-panel-tts-text').value, host.playheadMs())
          : global.MSWTts.snapshot(host.data, host.selection(), el('tts-target').value)),
        provider: { recipe: options, ...(options.provider === 'qwen' ? {apiKey: options.region === el('tts-region').value ? el('tts-key').value : ''}
          : options.provider === 'indextts' ? indexTts.connection() : {}) },
        ...(retry ? { retry_of: retry.retry_of } : {}) };
      if (!pending && !retry && !isText() && ['yukkuri', 'indextts'].includes(options.provider) && input.snapshot.entries.length === 1) {
        const override = el(options.provider === 'indextts' ? 'tts-index-pronunciation' : 'tts-yukkuri-pronunciation').value.trim();
        if (override) input.snapshot.entries[0].pronunciation_override = override;
      }
      pending = input; busy = true; updateScope();
      const data = await request('jobs', input);
      if (generation !== host.generation) return;
      pending = null;
      jobs.set(data.job.id, data.job); watched.add(data.job.id);
      updateScope();
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
    previewUrl = null; previewId = null; previewOwner = '';
    el('asset-player').hidden = true;
    updatePreviewButtons();
  }
  function stopReference(owner) { if (previewOwner === owner) stopPreview(); }
  async function playReference(owner, label, load, valid = () => true) {
    stopPreview(); previewOwner = owner;
    const sequence = previewSequence, generation = host.generation;
    host.showAssets({automatic: true}); el('asset-player').hidden = false;
    el('asset-playing').textContent = t('正在加载音频…');
    try {
      const source = await load();
      if (sequence !== previewSequence || generation !== host.generation || !valid()) return;
      previewUrl = typeof source === 'string' ? source : URL.createObjectURL(source);
      el('asset-audio').src = previewUrl; el('asset-playing').textContent = label;
      host.pauseMedia(); await el('asset-audio').play();
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
      new Option(`${new Date(job.created_at * 1000).toLocaleString()} · ${job.recipe?.provider === 'imported' ? t('外部音频') : job.recipe?.voice || 'TTS'} · ${job.id.slice(-6)}`, job.id)));
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
      if (asset.generation.provider === 'imported') meta.textContent = `${t('外部音频')} · ${duration.toFixed(2)} s · ${asset.generation.filename || ''}`;
      else if (source.kind === 'editor_text') meta.textContent = `${asset.generation.voice} · ${duration.toFixed(2)} s · ${t('文本配音')} · ${(source.start / 1000).toFixed(2)} s`;
      else if (duration > (source.end - source.start) / 1000 + .1) meta.textContent += ` · ${t('长于字幕')}`;
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
      const remove = iconAction('删除素材', 'remove', () => {
        const count = (host.data.msw?.audio_clips || []).filter(clip => clip.asset_id === asset.id).length;
        if (count && !global.confirm(t(`此素材已被 ${count} 个音频贴片使用。删除素材并同时移除这些贴片？可撤销。`))) return;
        if (previewId === asset.id || !previewId) stopPreview();
        if (host.removeAsset(asset.id)) host.flashHint(t('素材已移除，可撤销；原文件保留'), 'success');
      });
      buttons.append(play, save, insert, remove); row.append(content, buttons); fragment.append(row);
    }
    list.replaceChildren(fragment); updatePreviewButtons();
    if (focusedId && focusedAction) {
      const card = [...list.children].find(row => row.dataset.assetId === focusedId);
      card?.querySelector(`[data-asset-action="${focusedAction}"]`)?.focus({ preventScroll: true });
    }
    list.scrollTop = scroll;
  }
  el('tts-open').addEventListener('click', () => {
    host.commitEdits(); panel.open(); syncDraft(); updateScope();
    if (available) {
      if (!configured) void ensureSettings().catch(error => message(error.message, true));
      else if (isYukkuri()) void pollRuntime();
      else if (!isIndex()) qwenVoices.reopen();
      schedule(0);
    }
  });
  el('tts-close').addEventListener('click', () => { indexTts.stopPreview(); panel.close(); syncDraft(); });
  el('tts-start').addEventListener('click', () => void submit());
  el('tts-target').addEventListener('change', () => { el('tts-yukkuri-pronunciation').value = ''; el('tts-index-pronunciation').value = ''; syncDraft(); updateScope(); });
  el('cue-panel-tts-text').addEventListener('input', updateScope);
  el('cue-panel-tts-copy').addEventListener('click', () => {
    if (el('cue-panel-tts-text').value.trim() && !global.confirm(t('用当前字幕替换配音草稿？字幕不会被修改。'))) return;
    el('cue-panel-tts-text').value = host.editorText(); updateScope(); el('cue-panel-tts-text').focus();
  });
  // Includes Escape and window-management closure, not just the close button.
  new MutationObserver(() => { syncDraft(); updateScope(); }).observe(el('tts-panel'), {attributes: true, attributeFilter: ['class']});
  el('tts-engine').addEventListener('change', updateEngine);
  el('tts-yukkuri-speed').addEventListener('input', () => { el('tts-yukkuri-speed-value').value = el('tts-yukkuri-speed').value; });
  for (const id of ['voice', 'language', 'speed']) el(`tts-yukkuri-${id}`).addEventListener('input', () => stopReference('yukkuri'));
  el('tts-yukkuri-preview').addEventListener('click', async () => {
    if (yukkuriPreviewBusy || runtime.state !== 'ready') return;
    yukkuriPreviewBusy = true; el('tts-yukkuri-preview').disabled = true;
    const settings = recipeFor('yukkuri'), version = host.generation;
    try {
      await playReference('yukkuri', `${t('音色试听')} · ${settings.voice.toUpperCase()} · ${settings.speed}%`,
        () => request('yukkuri-preview', {recipe: settings}, true), () => isYukkuri());
    } catch (error) { if (version === host.generation && isYukkuri()) message(error.message, true); }
    finally { yukkuriPreviewBusy = false; el('tts-yukkuri-preview').disabled = runtime.state !== 'ready'; }
  });
  el('tts-yukkuri-install').addEventListener('click', () => void runtimeAction('install'));
  el('tts-yukkuri-check').addEventListener('click', () => void runtimeAction('check'));
  el('tts-yukkuri-cancel').addEventListener('click', () => void runtimeAction('cancel'));
  el('tts-region').addEventListener('change', () => { el('tts-key').value = ''; keyState(); qwenVoices.credentialsChanged(); });
  el('tts-key').addEventListener('input', updateScope);
  el('tts-environment-open').addEventListener('click', () => {
    el('tts-environment-engine').value = el('tts-engine').value;
    panel.close(); host.openTtsEnvironment();
  });
  el('tts-environment-engine').addEventListener('change', () => {
    qwenVoices.stopPreview(); indexTts.stopPreview(); void environmentView();
  });
  global.addEventListener('msw:settings-opened', () => void environmentView());
  el('tts-environment-unavailable').hidden = available;
  el('tts-environment-save').disabled = !available;
  el('tts-environment-engine').disabled = !available;
  if (!available) for (const control of el('tts-environment-category').querySelectorAll('input, select, textarea, button')) control.disabled = true;
  el('tts-environment-save').addEventListener('click', async () => {
    if (savingSettings || indexTts.isBusy()) return;
    const button = el('tts-environment-save'), engine = el('tts-environment-engine').value;
    savingSettings = true; button.disabled = true; updateScope();
    try {
      await ensureSettings();
      await request('tts-environment', {recipe: recipeFor(engine), ...(engine === 'indextts' ? indexTts.connection()
        : engine === 'qwen' ? {apiKey: el('tts-key').value} : {})});
      if (engine === 'qwen') el('tts-key').value = '';
      await loadSettings(true);
      el('tts-environment-message').textContent = t('环境配置已保存到本机');
      if (engine === 'qwen') qwenVoices.management();
    } catch (error) { el('tts-environment-message').textContent = error.message; }
    finally { savingSettings = false; updateScope(); }
  });
  el('tts-save-settings').addEventListener('click', async () => {
    if (savingSettings || indexTts.isBusy()) return;
    savingSettings = true; updateScope();
    try { await request('tts-settings', { recipe: recipe(), ...(isIndex() ? indexTts.connection() : isYukkuri() ? {} : {apiKey: el('tts-key').value}) });
      if (!isIndex() && !isYukkuri()) el('tts-key').value = '';
      await loadSettings(true); message('合成设置已保存到本机'); }
    catch (error) { message(error.message, true); }
    finally { savingSettings = false; updateScope(); }
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
  global.addEventListener('msw:assets-changed', () => {
    if (previewId && !assets().some(asset => asset.id === previewId)) stopPreview();
    renderAssets();
  });
  for (const event of ['play', 'pause', 'ended']) el('asset-audio').addEventListener(event, updatePreviewButtons);
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
    const generation = host.generation, id = projectId();
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
          host.addAssets(id, [result.asset]); success++; renderAssets();
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
      download(blob, 'project-with-tts.zip');
      el('asset-notice').textContent = t('已导出工程与 TTS 音频；解压后打开 project.mosp。原视频仍需原媒体文件。');
    } catch (error) { if (generation === host.generation) el('asset-notice').textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.addEventListener('play', event => {
    if (event.target === el('asset-audio')) host.pauseMedia();
    else if (event.target.id === 'player') {
      if (previewOwner && !previewUrl) stopPreview();
      else el('asset-audio').pause();
    }
  }, true);
  global.addEventListener('msw:project-changed', () => {
    stopImport = true; el('asset-import-status').hidden = true;
    stopPreview(); jobs.clear(); watched.clear(); opened.clear(); firstReady.clear(); missing.clear();
    jobCursor = 0; assetCursor = 0; pending = null; busy = false; scopeSignature = ''; page = 0;
    el('asset-search').value = ''; el('asset-batch').value = ''; el('tts-target').value = 'main';
    draftInitialized = false; el('cue-panel-tts-text').value = ''; syncDraft();
    el('asset-playing').textContent = t('选择音频试听');
    el('asset-player').hidden = true;
    queueMicrotask(() => { updateScope(); renderAssets(); renderJobs(); message(''); schedule(0); });
  });
  updateScope(); renderAssets(); if (available) schedule(0);
})(window);
