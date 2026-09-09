// Editor translation UI and asynchronous job client. No provider secrets stored in the page's persistence.
(function (global) {
  'use strict';
  const host = global.MSWE?.resolve('processing-host');
  if (!host) return;
  const el = (id) => document.getElementById(id);
  const t = (value) => global.MSWE_I18N?.translateText?.(value) || value;
  const panel = el('subtitle-translation-panel');
  const button = el('subtitle-translate-btn');
  const available = Boolean(host.config?.processingUrl);
  const pageId = global.MSWProject.id('page');
  const clientToken = () => `${pageId}.${host.generation}`;
  const projectId = () => global.MSWProject.ensure(host.data).project_id;
  const jobs = new Map();
  const handled = new Set();
  const applying = new Set();
  let providers = [];
  let cursor = 0;
  let timer = null;
  let polling = false;
  let failures = 0;
  let requestInFlight = false;
  let pendingSubmission = null;
  let loadingProviders = null, savingSettings = false, providerError = '';

  function message(value, error = false) {
    el('translation-message').textContent = t(value);
    el('translation-message').classList.toggle('is-error', error);
  }
  function environmentMessage(value, error = false) {
    el('llm-message').textContent = t(value);
    el('llm-message').classList.toggle('is-error', error);
  }
  function updateEnvironment() {
    const provider = providers.find(item => item.id === el('translation-provider').value);
    const issue = providerError || (!provider ? '正在读取本机 LLM 配置…' : !provider.hasApiKey
      ? '当前 LLM 服务尚未配置密钥，请前往环境配置。' : !provider.baseUrl || !provider.model ? '请在 LLM 环境配置中填写 API 地址和模型。' : '');
    el('translation-environment-notice').hidden = !available || !issue;
    el('translation-environment-notice').textContent = t(issue);
    const failed = [...jobs.values()].some(job => job.kind === 'translation' && job.status === 'failed');
    el('translation-environment-reminder').hidden = !available || (!issue && !failed);
    for (const field of el('llm-controls').querySelectorAll('input, select, button')) field.disabled = savingSettings || Boolean(loadingProviders) || requestInFlight || Boolean(pendingSubmission);
    if (pendingSubmission?.kind === 'connection_test' && !requestInFlight) el('translation-test').disabled = false;
    return Boolean(provider && !issue);
  }
  async function request(route, body = null) {
    const response = await fetch(`${host.config.processingUrl}/${route}`, {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { 'X-MSW-Token': host.config.requestToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const error = new Error(data.error || `${t('处理服务请求失败')} (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function updateScope() {
    const selection = host.selection();
    const scope = global.MSWTranslation.scope(host.data, selection.mainIds, selection.extensionIds, selection.trackId, selection.hasSelection);
    el('translation-scope').textContent = `${t(scope.all ? '范围：全部主字幕' : '范围：选中的主字幕')} · ${scope.sources.length}`
      + (scope.ignored ? ` · ${t('已忽略未绑定副字幕')} ${scope.ignored}` : '');
    const ready = updateEnvironment();
    el('translation-start').disabled = !available || requestInFlight || savingSettings || (!ready && pendingSubmission?.kind !== 'translation') || !scope.sources.length;
    const emptyScopeMessage = '没有可翻译的主字幕；未绑定的副字幕不会触发全量翻译';
    if (selection.hasSelection && !scope.sources.length) message(emptyScopeMessage, true);
    else if (el('translation-message').textContent === t(emptyScopeMessage)) message('');
    return scope;
  }
  function providerInput() {
    return { providerId: el('llm-provider').value, baseUrl: el('translation-base-url').value.trim(),
      model: el('translation-model').value.trim(), apiKey: el('translation-api-key').value,
      reasoningMode: el('translation-reasoning').value };
  }
  function selectProvider() {
    const provider = providers.find((item) => item.id === el('llm-provider').value);
    if (!provider) return;
    el('translation-base-url').value = provider.baseUrl;
    el('translation-model').value = provider.model;
    el('translation-reasoning').value = provider.reasoningMode || 'auto';
    el('translation-api-key').value = '';
    el('translation-key-state').textContent = t(provider.hasApiKey
      ? '已配置本机密钥；留空即可复用启动器设置' : '尚未配置密钥；可填写后使用或保存');
  }
  async function loadProviders() {
    if (loadingProviders) return loadingProviders;
    loadingProviders = (async () => { try {
      const selected = el('translation-provider').value;
      const managed = el('llm-provider').value;
      const data = await request('providers');
      providers = data.providers;
      el('translation-provider').replaceChildren(...providers.map((provider) => new Option(provider.label, provider.id)));
      el('translation-provider').value = selected || data.selectedProvider || providers[0]?.id;
      el('llm-provider').replaceChildren(...providers.map((provider) => new Option(provider.label, provider.id)));
      el('llm-provider').value = managed || el('translation-provider').value;
      providerError = '';
      selectProvider();
    } catch (error) { providerError = error.message; environmentMessage(error.message, true); }
    finally { loadingProviders = null; updateScope(); } })();
    updateScope(); return loadingProviders;
  }
  function action(label, callback) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t(label);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await callback(); } catch (error) { message(error.message, true); }
      finally { button.disabled = false; }
    });
    return button;
  }
  const statusText = { queued: '等待处理', running: '正在处理', succeeded: '处理完成', failed: '处理失败',
    cancel_requested: '正在取消', cancelled: '已取消', interrupted: '服务中断，未自动重试' };
  function renderJobs() {
    const target = el('translation-jobs'), scroll = target.scrollTop;
    const tests = el('llm-test-jobs'), testScroll = tests.scrollTop, testFragment = document.createDocumentFragment();
    const previews = new Map([...target.children].map(card => [card.dataset.jobId, card.querySelector('.msw-translation-results')]));
    const fragment = document.createDocumentFragment();
    const sorted = [...jobs.values()].sort((a, b) => b.created_at - a.created_at);
    const translations = sorted.filter(job => job.kind === 'translation').slice(0, 20), connections = sorted.filter(job => job.kind === 'connection_test').slice(0, 20);
    for (const job of [...translations, ...connections]) {
      const card = document.createElement('article');
      card.className = 'msw-processing-job';
      card.dataset.jobId = job.id;
      const title = document.createElement('strong');
      title.textContent = job.kind === 'connection_test' ? t('测试连接') : `${t('字幕翻译')} · ${job.count}`;
      const status = document.createElement('p');
      status.className = 'msw-processing-hint';
      status.textContent = t(statusText[job.status] || job.status);
      if (job.status === 'running' && job.progress?.total) status.textContent += ` · ${job.progress.current}/${job.progress.total}`;
      if (job.application === 'applied') status.textContent += ` · ${t('结果已应用')}`;
      if (job.application === 'stale') status.textContent += ` · ${t('部分结果需要检查')}`;
      if (job.application === 'discarded') status.textContent += ` · ${t('结果已忽略')}`;
      card.append(title, status);
      if (job.error) {
        const error = document.createElement('p');
        error.className = 'msw-processing-message is-error';
        error.textContent = job.error;
        card.append(error);
      }
      const actions = document.createElement('div');
      actions.className = 'msw-processing-actions';
      if (['queued', 'running', 'cancel_requested'].includes(job.status)) {
        actions.append(action('取消任务', async () => {
          const result = await request(`jobs/${job.id}/cancel`, { project_id: job.project_id });
          jobs.set(job.id, result.job); renderJobs(); schedulePoll(0);
        }));
      }
      if (job.status === 'succeeded' && job.kind === 'translation') {
        actions.append(action('查看译文', () => showResult(job, card)));
        if (!['applied', 'discarded'].includes(job.application)) {
          actions.append(action('检查并应用', () => applyResult(job, true)));
          actions.append(action('忽略结果', async () => {
            const result = await request(`jobs/${job.id}/ack`, { project_id: job.project_id, application: 'discarded' });
            handled.add(job.id); jobs.set(job.id, result.job); renderJobs();
          }));
        }
      }
      card.append(actions);
      if (previews.get(job.id)) card.append(previews.get(job.id));
      (job.kind === 'connection_test' ? testFragment : fragment).append(card);
    }
    target.replaceChildren(fragment); target.scrollTop = scroll;
    tests.replaceChildren(testFragment); tests.scrollTop = testScroll;
    el('translation-history-count').textContent = `(${translations.length})`;
    el('llm-test-count').textContent = `(${connections.length})`;
    updateEnvironment();
  }
  async function showResult(job, card) {
    const generation = host.generation;
    const data = await request(`jobs/${job.id}/result?project_id=${encodeURIComponent(job.project_id)}`);
    if (generation !== host.generation || job.project_id !== projectId()) return;
    card = [...el('translation-jobs').children].find(item => item.dataset.jobId === job.id);
    if (!card) return;
    card.querySelector('.msw-translation-results')?.remove();
    const preview = document.createElement('div');
    preview.className = 'msw-translation-results';
    const sources = new Map(data.job.snapshot.entries.map((entry) => [entry.source.id, entry.source.text]));
    const rows = data.job.result.translations;
    let shown = 0;
    const more = action('查看更多译文', () => appendPage());
    function appendPage() {
      more.remove();
      const end = Math.min(shown + 50, rows.length);
      for (; shown < end; shown += 1) {
        const row = rows[shown];
        const item = document.createElement('div');
        const source = document.createElement('p'); source.textContent = sources.get(row.id) || '';
        const text = document.createElement('textarea'); text.readOnly = true; text.rows = 2; text.value = row.text;
        text.setAttribute('aria-label', t('翻译结果'));
        item.append(source, text); preview.append(item);
      }
      if (shown < rows.length) preview.append(more);
    }
    appendPage();
    card.append(preview);
  }
  async function applyResult(job, manual = false) {
    if (applying.has(job.id) || (!manual && (handled.has(job.id) || host.isEditing()))) return;
    if (!manual && job.client_token !== clientToken()) return;
    const generation = host.generation;
    applying.add(job.id);
    try {
      const data = await request(`jobs/${job.id}/result?project_id=${encodeURIComponent(job.project_id)}`);
      if (generation !== host.generation || job.project_id !== projectId() || (!manual && host.isEditing())) return;
      const result = host.applyTranslation(data.job);
      handled.add(job.id);
      const text = `${t('已更新副字幕')} ${result.appliedIds.length}`
        + (result.conflicts.length ? `；${t('未应用')} ${result.conflicts.length}：${[...new Set(result.conflicts.map((item) => t(item.reason)))].join('；')}` : '');
      message(text, result.conflicts.length > 0);
      host.flashHint(text, result.conflicts.length ? 'warning' : 'success');
      // The edit above is synchronous and atomic. Failure to acknowledge never
      // rolls it back; persistent per-result IDs prevent a duplicate application.
      const application = result.complete ? 'applied' : 'stale';
      jobs.set(job.id, { ...job, application }); renderJobs();
      await request(`jobs/${job.id}/ack`, { project_id: job.project_id, application });
    } catch (error) {
      handled.add(job.id);
      message(error.message, true);
    } finally { applying.delete(job.id); }
  }
  function schedulePoll(delay = 800) {
    if (!available) return;
    clearTimeout(timer);
    timer = setTimeout(poll, delay);
  }
  async function poll() {
    if (polling || !available) return;
    polling = true;
    const generation = host.generation;
    const id = projectId();
    try {
      const data = await request(`jobs?project_id=${encodeURIComponent(id)}&since=${cursor}`);
      if (generation !== host.generation || id !== projectId()) return;
      failures = 0; cursor = data.revision;
      for (const job of data.jobs) if (job.kind !== 'tts') {
        jobs.set(job.id, job);
        if (job.kind === 'connection_test' && !['queued', 'running', 'cancel_requested'].includes(job.status)) {
          environmentMessage(`${t('测试连接')}：${t(statusText[job.status] || job.status)}${job.error ? ' · ' + job.error : ''}`, job.status === 'failed');
        }
      }
      if (data.jobs.length) renderJobs();
      for (const job of jobs.values()) {
        if (job.status === 'succeeded' && job.application === 'pending' && job.kind === 'translation') await applyResult(job);
      }
      const pending = [...jobs.values()].some((job) => ['queued', 'running', 'cancel_requested'].includes(job.status)
        || (job.status === 'succeeded' && job.application === 'pending' && job.client_token === clientToken() && !handled.has(job.id)));
      if (pending) schedulePoll();
    } catch (error) {
      failures += 1;
      message(error.message, true);
      if (failures < 6) schedulePoll(Math.min(10000, 1000 * 2 ** failures));
    } finally {
      polling = false;
      if (generation !== host.generation) schedulePoll(0);
    }
  }
  async function submit(kind) {
    if (requestInFlight || savingSettings || (kind === 'translation' && !pendingSubmission && !updateEnvironment())) return;
    const report = kind === 'connection_test' ? environmentMessage : message;
    if (pendingSubmission && pendingSubmission.kind !== kind) {
      report('上次提交尚未确认，请先重试相同操作以确认任务状态', true);
      return;
    }
    const generation = host.generation;
    try {
      const snapshot = kind === 'translation' && !pendingSubmission ? host.capture() : null;
      requestInFlight = true; updateScope();
      const payload = pendingSubmission || { kind, project_id: projectId(), client_token: clientToken(),
        request_key: global.MSWProject.id('request'), snapshot, provider: kind === 'connection_test' ? providerInput() : {providerId: el('translation-provider').value},
        language: el('translation-language').value, prompt: el('translation-prompt').value };
      pendingSubmission = payload;
      const data = await request('jobs', payload);
      pendingSubmission = null;
      if (generation !== host.generation) return;
      jobs.set(data.job.id, data.job);
      report(kind === 'translation' ? '翻译已开始，可以继续编辑；关闭此窗口不会取消任务' : '正在测试连接');
      el(kind === 'translation' ? 'translation-history' : 'llm-test-history').open = true;
      renderJobs(); schedulePoll(0);
    } catch (error) {
      if (error.status && error.status < 500) pendingSubmission = null;
      report(pendingSubmission ? `${error.message}；${t('再次点击将确认上次提交，不会重复创建任务')}` : error.message, true);
    } finally { requestInFlight = false; updateScope(); }
  }
  const floating = host.createFloatingPanel({ panel, dragHandle: el('subtitle-translation-drag'),
    anchorButton: document.querySelector('[data-menubar-item="subtitle"] > button'), positionKey: 'msw.translation.panel.position' });
  button.addEventListener('click', () => {
    host.commitEdits(); updateScope(); floating.open();
    if (available) {
      if (!providers.length) void loadProviders();
      schedulePoll(0);
    }
  });
  el('subtitle-translation-close').addEventListener('click', () => floating.close());
  el('translation-unavailable').hidden = available;
  el('translation-controls').hidden = !available;
  el('translation-provider').addEventListener('change', updateScope);
  el('llm-provider').addEventListener('change', selectProvider);
  el('llm-unavailable').hidden = available;
  el('llm-controls').hidden = !available;
  global.addEventListener('msw:settings-opened', () => { if (available && (!providers.length || providerError)) void loadProviders(); });
  el('translation-environment-open').addEventListener('click', () => {
    if (providers.length) { el('llm-provider').value = el('translation-provider').value; selectProvider(); }
    floating.close(); host.openLlmEnvironment();
  });
  el('translation-start').addEventListener('click', () => void submit('translation'));
  el('translation-test').addEventListener('click', () => void submit('connection_test'));
  el('translation-save-settings').addEventListener('click', async () => {
    if (savingSettings || requestInFlight || pendingSubmission) return;
    savingSettings = true; updateScope();
    try { await request('providers', providerInput()); await loadProviders(); environmentMessage('配置已保存，与启动器共用'); }
    catch (error) { environmentMessage(error.message, true); }
    finally { savingSettings = false; updateScope(); }
  });
  for (const event of ['pointerup', 'keyup']) document.addEventListener(event, () => {
    if (floating.isOpen()) queueMicrotask(updateScope);
  });
  global.addEventListener('msw:project-changed', () => {
    clearTimeout(timer); cursor = 0; jobs.clear(); handled.clear(); pendingSubmission = null;
    queueMicrotask(() => { updateScope(); renderJobs(); message(''); schedulePoll(0); });
  });
  updateScope();
  if (available) schedulePoll(0);
})(window);
