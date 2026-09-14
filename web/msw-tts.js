// TTS task UI. Audio bytes stay outside editor snapshots.
(function (global) {
  'use strict';
  const host = global.MSWE?.resolve('processing-host');
  if (!host?.assetLibrary) return;
  const library = host.assetLibrary;
  const el = id => document.getElementById(id) || library.querySelector(`#${id}`);
  const t = value => global.MSWE_I18N?.translateText?.(value) || value;
  // The asset content region skips automatic translation to protect user text.
  el('asset-playing').textContent = t('选择音频试听');
  const available = Boolean(host.config?.processingUrl);
  const projectId = () => global.MSWProject.ensure(host.data).project_id;
  const pageId = global.MSWProject.id('tts-page');
  const jobs = new Map(), watched = new Set(), opened = new Set(), firstReady = new Set();
  let jobCursor = 0, assetCursor = 0, timer, polling = false, pollFailures = 0;
  let nextPollDelay = null;
  let configured = false, regions = [], busy = false, pending = null, scopeSignature = '';
  let settingsPromise = null, savingSettings = false;
  let draftActive = false, draftInitialized = false;
  let draftRevision = 0, pendingDraft = null, clearedDraft = null;
  const draftJobs = new Map();
  const isText = () => el('tts-target').value === 'editor_text';
  let runtime = {state: 'idle', runtime_path: ''}, runtimeTimer, runtimeRequest = false;
  const isYukkuri = () => el('tts-engine').value === 'yukkuri';
  const isIndex = () => el('tts-engine').value === 'indextts';
  let yukkuriPreviewBusy = false;
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
  const assetUI = global.MSWAssetLibrary.create({host, request, jobs, schedule});
  const {renderAssets, playReference, stopReference} = assetUI;
  const qwenVoices = global.MSWQwenVoices.create({el, t, request, recipe: qwenRecipe, updateScope,
    playReference, stopReference, generation: () => host.generation});
  const indexTts = global.MSWIndexTts.create({el, t, request, updateScope,
    playReference, stopReference, generation: () => host.generation});
  function syncDraft() {
    const next = available && isText() && panel.isOpen() && !assetUI.editing;
    if (next === draftActive) return;
    if (next) {
      host.commitEdits();
      if (!draftInitialized) { el('cue-panel-tts-text').value = host.editorText(); draftInitialized = true; }
      host.showCueEditor();
    }
    draftActive = next;
    el('current-cue-panel').classList.toggle('tts-draft-mode', next);
    el('cue-panel-tts-text').hidden = !next; el('cue-panel-tts-footer').hidden = !next;
    el('cue-panel-tts-preview').hidden = !next;
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
    const parts = global.MSWTts.splitDraft(el('cue-panel-tts-text').value, host.draftSettings());
    const scope = isText() ? {signature: 'editor_text', sources: parts,
      tooLong: parts.filter(part => [...part].length > 600).length || (parts.length > 10000 ? 1 : 0)} : global.MSWTts.scope(host.data, host.selection(), el('tts-target').value);
    if (scope.signature !== scopeSignature) {
      scopeSignature = scope.signature;
      el('tts-yukkuri-pronunciation').value = '';
      el('tts-index-pronunciation').value = '';
    }
    el('tts-scope').textContent = (isText() ? `${t('范围：独立配音草稿 · 不修改字幕')} · ${parts.length} ${t('条')}`
      : `${t(scope.all ? '范围：全部字幕' : '范围：所选字幕')} · ${scope.sources.length} ${t('条')}`
        + (scope.linked ? ` · ${t('连锁字幕按操作对象合成，独立字幕保留原选区')}` : ''))
      + (scope.tooLong ? ` · ${scope.tooLong} ${t('条超过 600 字符，请先拆分')}` : '');
    el('cue-panel-tts-count').textContent = `${parts.length} ${t('段')} · ${t('最长')} ${parts.reduce((n, part) => Math.max(n, [...part].length), 0)} / 600`;
    if (el('cue-panel-tts-preview').open) renderDraftPreview(parts);
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
  function renderDraftPreview(parts = global.MSWTts.splitDraft(el('cue-panel-tts-text').value, host.draftSettings())) {
    const list = el('cue-panel-tts-parts'); list.replaceChildren();
    for (const part of parts.slice(0, 100)) { const row = document.createElement('li'); row.textContent = part; list.appendChild(row); }
    if (parts.length > 100) { const row = document.createElement('li'); row.textContent = t('仅预览前 100 段'); list.appendChild(row); }
  }
  function checkDraftCompletion() {
    const ready = new Set(assets().map(asset => asset.source_ref.key));
    for (const group of new Set(draftJobs.values())) {
      if (group.done) continue;
      const states = [...group.jobs].map(id => jobs.get(id)?.status);
      if (states.some(status => ['cancelled', 'cancel_requested', 'interrupted'].includes(status))) group.cancelled = true;
      if (states.some(status => !status || active({ status })) || !group.keys.every(key => ready.has(key))) continue;
      group.done = true;
      if (group.cancelled || !group.clear || group.generation !== host.generation || group.revision !== draftRevision
          || group.text !== el('cue-panel-tts-text').value) continue;
      clearedDraft = group.text;
      el('cue-panel-tts-text').value = ''; draftRevision++;
      el('cue-panel-tts-restore').hidden = false;
      updateScope();
    }
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
      actions.append(action('查看素材', () => { host.showAssets(); assetUI.showBatch(job.id); }));
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
      const newDraft = !pending && !retry && isText();
      const input = pending || { kind: 'tts', project_id: projectId(), client_token: `${pageId}.${generation}`,
        library_size: assets().length,
        removed_asset_ids: host.data.msw?.removed_asset_ids || [],
        request_key: global.MSWProject.id('request'), snapshot: retry?.snapshot || (isText()
          ? global.MSWTts.textSnapshot(host.data, el('cue-panel-tts-text').value, host.playheadMs(), host.draftSettings())
          : global.MSWTts.snapshot(host.data, host.selection(), el('tts-target').value)),
        provider: { recipe: options, ...(options.provider === 'qwen' ? {apiKey: options.region === el('tts-region').value ? el('tts-key').value : ''}
          : options.provider === 'indextts' ? indexTts.connection() : {}) },
        ...(retry ? { retry_of: retry.retry_of } : {}) };
      if (!pending && !retry && !isText() && ['yukkuri', 'indextts'].includes(options.provider) && input.snapshot.entries.length === 1) {
        const override = el(options.provider === 'indextts' ? 'tts-index-pronunciation' : 'tts-yukkuri-pronunciation').value.trim();
        if (override) input.snapshot.entries[0].pronunciation_override = override;
      }
      if (newDraft) pendingDraft = { generation, revision: draftRevision, text: el('cue-panel-tts-text').value,
        clear: host.draftSettings().ttsDraftClearOnSuccess !== false, keys: input.snapshot.entries.map(row => row.key), jobs: new Set() };
      else if (!pending) pendingDraft = retry ? draftJobs.get(retry.retry_of) || null : null;
      pending = input; busy = true; updateScope();
      const data = await request('jobs', input);
      if (generation !== host.generation) return;
      pending = null;
      if (pendingDraft) { pendingDraft.jobs.add(data.job.id); draftJobs.set(data.job.id, pendingDraft); pendingDraft = null; }
      jobs.set(data.job.id, data.job); watched.add(data.job.id);
      updateScope();
      message('TTS 已开始；每条完成后可在素材库试听，关闭此窗口不会取消任务');
      el('tts-settings').open = false;
      renderJobs(); schedule(0);
    } catch (error) {
      if (generation !== host.generation) return;
      if (error.status && error.status < 500) { pending = null; pendingDraft = null; }
      message(pending ? `${error.message}；${t('再次点击将确认上次提交，不会重复创建任务')}` : error.message, true);
    } finally { if (generation === host.generation) { busy = false; updateScope(); } }
  }
  function schedule(delay = 800) {
    clearTimeout(timer);
    if (polling) {
      nextPollDelay = nextPollDelay == null ? delay : Math.min(nextPollDelay, delay);
      return;
    }
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
      checkDraftCompletion();
      pollFailures = 0;
      if (incoming.more || [...jobs.values()].some(active)) schedule(incoming.more ? 0 : 800);
    } catch (error) {
      if (generation !== host.generation) return;
      message(error.message, true); pollFailures += 1;
      if (pollFailures < 6) schedule(Math.min(10000, 1000 * 2 ** pollFailures));
    } finally {
      polling = false;
      const delay = nextPollDelay;
      nextPollDelay = null;
      if (generation !== host.generation) schedule(0);
      else if (delay != null) schedule(delay);
    }
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
  el('cue-panel-tts-text').addEventListener('input', () => { draftRevision++; updateScope(); });
  el('cue-panel-tts-preview').addEventListener('toggle', () => { if (el('cue-panel-tts-preview').open) renderDraftPreview(); });
  global.addEventListener('msw:asset-editing',syncDraft);
  global.addEventListener('msw:draft-settings', updateScope);
  global.addEventListener('msw:tts-refresh', () => schedule(0));
  el('cue-panel-tts-restore').addEventListener('click', () => {
    if (clearedDraft == null) return;
    if (el('cue-panel-tts-text').value.trim() && !global.confirm(t('用上次草稿替换当前配音草稿？'))) return;
    el('cue-panel-tts-text').value = clearedDraft; draftRevision++; clearedDraft = null;
    el('cue-panel-tts-restore').hidden = true; updateScope(); el('cue-panel-tts-text').focus();
  });
  el('cue-panel-tts-copy').addEventListener('click', () => {
    if (el('cue-panel-tts-text').value.trim() && !global.confirm(t('用当前字幕替换配音草稿？字幕不会被修改。'))) return;
    el('cue-panel-tts-text').value = host.editorText(); draftRevision++; updateScope(); el('cue-panel-tts-text').focus();
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
  global.addEventListener('msw:project-changed', () => {
    jobs.clear(); watched.clear(); opened.clear(); firstReady.clear();
    jobCursor = 0; assetCursor = 0; pending = null; busy = false; scopeSignature = '';
    el('tts-target').value = 'main';
    draftInitialized = false; el('cue-panel-tts-text').value = ''; syncDraft();
    draftRevision++; pendingDraft = null; clearedDraft = null; draftJobs.clear(); el('cue-panel-tts-restore').hidden = true;
    el('asset-playing').textContent = t('选择音频试听');
    el('asset-player').hidden = true;
    queueMicrotask(() => { updateScope(); renderAssets(); renderJobs(); message(''); schedule(0); });
  });
  updateScope(); renderAssets(); if (available) schedule(0);
})(window);
