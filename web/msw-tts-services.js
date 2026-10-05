// Shared local service controls. Only explicit Start or synthesis starts models.
(function (global) {
  'use strict';
  function create({el, t, request, updateScope, connected, checkConnection}) {
    const states = new Map(), controls = new Map(), pending = new Set(), operations = new Map();
    let timer;
    const externalChecks = new Map();
    const names = {indextts: 'IndexTTS', 'gpt-sovits': 'GPT-SoVITS'};
    const prefix = kind => kind === 'indextts' ? 'tts-index-' : 'tts-gpt-';
    const loading = s => ['checking', 'loading'].includes(s?.state);
    const ready = s => ['ready', 'external'].includes(s?.state);
    function renderCall() {
      const kind = el('tts-engine').value, ui = controls.get(kind), box = el('tts-local-call');
      box.hidden = !ui;
      if (!ui) return;
      el('tts-local-call-name').textContent = names[kind];
      const status = el('tts-local-call-status'); status.textContent = ui.status.textContent;
      status.classList.toggle('is-error', ui.status.classList.contains('is-error'));
      status.setAttribute('aria-busy', ui.status.getAttribute('aria-busy') || 'false');
      for (const key of ['check', 'start', 'stop']) {
        const button = el('tts-local-call-' + key), source = ui[key];
        button.textContent = source.textContent; button.disabled = source.disabled; button.hidden = source.hidden;
      }
    }
    function render(kind, state) {
      const previous = states.get(kind);
      if (externalChecks.get(kind) === controls.get(kind).url.value.trim() && !state.owned) state = {...state, state:'external', message:'外部服务 · 已连接'};
      states.set(kind, state);
      const ui = controls.get(kind), wait = !ui.initialized || pending.has(kind) || loading(state);
      const operation = operations.get(kind);
      ui.status.textContent = t(!ui.initialized ? '正在读取本机 TTS 配置…' : operation && operation !== 'pick'
        ? operation === 'check' ? '正在验证连接…' : operation === 'start' ? '正在启动服务…' : '正在停止服务…'
        : state.message || '尚未检测服务');
      ui.status.setAttribute('aria-busy', String(wait));
      ui.status.classList.toggle('is-error', ['failed', 'conflict'].includes(state.state));
      ui.log.textContent = (state.logs || []).join('\n'); ui.details.hidden = !state.logs?.length;
      ui.progress.hidden = !loading(state);
      ui.start.textContent = t(loading(state) ? '正在加载模型…' : '启动服务');
      ui.start.disabled = wait || ready(state) || state.owned || !state.configured;
      ui.start.hidden = ready(state);
      ui.check.disabled = wait; ui.check.dataset.serviceLocked = String(wait);
      ui.stop.hidden = !state.owned && !loading(state);
      ui.stop.textContent = t(state.owned ? '停止服务' : '取消启动');
      ui.stop.disabled = pending.has(kind);
      for (const input of [...ui.fields.querySelectorAll('input, button'), ...ui.advanced.querySelectorAll('input')]) {
        input.disabled = wait || state.owned;
        input.dataset.serviceLocked = String(input.disabled);
      }
      renderCall(); updateScope();
      if (kind === 'indextts' && ready(state) && !ready(previous)) connected();
      clearTimeout(timer);
      if ([...states.values()].some(s => loading(s) || s.owned)) timer = setTimeout(() => void refresh(), [...states.values()].some(loading) ? 900 : 5000);
    }
    function address(kind) {
      let url;
      try { url = new URL(controls.get(kind).url.value.trim()); } catch { throw Error(t('请填写有效的本机 HTTP 服务地址')); }
      const port = Number(url.port || 80);
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password
          || url.search || url.hash || !['', '/'].includes(url.pathname) || port < 1 || port > 65535)
        throw Error(t('请填写有效的本机 HTTP 服务地址'));
      return {port, managed: url.hostname !== '[::1]' && port >= 1024};
    }
    function values(kind) {
      const ui = controls.get(kind), target = address(kind);
      if (ui.directory.value.trim() && !target.managed) throw Error(t('由 MSW 启动时请使用 IPv4 本机地址和 1024–65535 端口'));
      return {directory: ui.directory.value.trim(), port: target.managed ? target.port : states.get(kind)?.settings?.port || (kind === 'indextts' ? 7860 : 9880),
        startup_timeout: Number(ui.timeout.value), qwen_emo: Boolean(ui.qwen?.checked)};
    }
    async function refresh(fill = false) {
      for (const kind of Object.keys(names)) {
        try {
          const {service} = await request(`tts-local-service?engine=${kind}`);
          if (fill) {
            const ui = controls.get(kind), cfg = service.settings;
            ui.directory.value = cfg.directory; ui.python.value = cfg.python || t('选择目录后自动检测');
            ui.timeout.value = String(cfg.startup_timeout);
            if (ui.qwen) ui.qwen.checked = cfg.qwen_emo;
            ui.initialized = true;
          }
          render(kind, service);
        } catch (error) {
          const ui = controls.get(kind);
          if (fill) { ui.initialized = true; render(kind, states.get(kind) || {}); }
          ui.status.textContent = error.message; ui.status.classList.add('is-error'); renderCall();
        }
      }
    }
    async function save(kind) {
      const {service} = await request('tts-local-service', {engine: kind, action: 'save', settings: values(kind)});
      const ui = controls.get(kind);
      ui.directory.value = service.settings.directory; ui.python.value = service.settings.python || t('选择目录后自动检测');
      if (service.configured && ui.url.value !== service.service_url) {
        ui.url.value = service.service_url; ui.url.dispatchEvent(new Event('input', {bubbles: true}));
      }
      render(kind, service); return service;
    }
    async function action(kind, action) {
      if (!controls.get(kind)?.initialized || pending.has(kind)) return;
      if (action === 'stop' && !global.confirm(t('停止服务会取消此引擎正在处理和等待的任务，是否继续？'))) return;
      pending.add(kind); operations.set(kind, action); render(kind, states.get(kind) || {});
      let failure = '';
      try {
        externalChecks.delete(kind);
        if (action === 'start' || action === 'check') await save(kind);
        if (action === 'check' && !address(kind).managed) {
          await checkConnection(kind); externalChecks.set(kind, controls.get(kind).url.value.trim()); return;
        }
        const {service} = await request('tts-local-service', {engine: kind, action, confirm: action === 'stop'});
        render(kind, service);
      } catch (error) { failure = error.message; }
      finally {
        pending.delete(kind); operations.delete(kind); render(kind, states.get(kind) || {}); await refresh();
        if (failure) { const ui = controls.get(kind); ui.status.textContent = failure; ui.status.classList.add('is-error'); renderCall(); }
      }
    }
    function field(label, type, id) {
      const wrapper = document.createElement('label'); wrapper.className = 'msw-processing-field';
      const title = document.createElement('span'); title.className = 'msw-option-label'; title.textContent = t(label);
      const input = document.createElement('input'); input.type = type; input.id = id;
      wrapper.append(title, input); return {wrapper, input};
    }
    for (const kind of Object.keys(names)) {
      const box = el(`tts-local-${kind}`), fields = document.createElement('div'); fields.className = 'msw-processing-grid';
      const advanced = document.createElement('details'), advancedTitle = document.createElement('summary'), extra = document.createElement('div');
      advanced.className = 'msw-local-advanced'; advancedTitle.textContent = t('高级启动设置'); extra.className = 'msw-processing-grid'; advanced.append(advancedTitle, extra);
      const ui = {fields, advanced, initialized: false}; controls.set(kind, ui);
      for (const [key, label, type] of [['directory','安装位置','text'], ['python','内置 Python','text'], ['timeout','启动等待上限（秒）','number']]) {
        const {wrapper, input} = field(label, type, `tts-local-${kind}-${key}`); ui[key] = input;
        if (key === 'directory') {
          wrapper.classList.add('msw-local-directory');
          const choose = document.createElement('button'); choose.type = 'button'; choose.textContent = t('选择文件夹');
          choose.onclick = async () => {
            if (pending.has(kind)) return;
            pending.add(kind); operations.set(kind, 'pick'); render(kind, states.get(kind) || {});
            let outcome = '', failed = false;
            try {
              const data = await request('tts-local-service', {engine: kind, action: 'pick'});
              if (data.directory) { input.value = data.directory; await save(kind); }
              else outcome = t('已取消目录选择');
            } catch (error) { outcome = error.message; failed = true; }
            finally {
              pending.delete(kind); operations.delete(kind); render(kind, states.get(kind) || {});
              if (outcome) { ui.status.textContent = outcome; ui.status.classList.toggle('is-error', failed); renderCall(); }
            }
          };
          const row = document.createElement('span'); row.className = 'msw-tts-directory-input'; row.append(input, choose); wrapper.append(row); fields.append(wrapper);
        } else {
          if (key === 'python') input.readOnly = true;
          if (key === 'timeout') { input.min = '30'; input.max = '3600'; input.value = '600'; }
          extra.append(wrapper);
        }
      }
      ui.url = el(prefix(kind) + 'url');
      ui.url.addEventListener('input', () => { externalChecks.delete(kind); render(kind, {...states.get(kind), state:'idle', message:'尚未检测服务'}); });
      fields.append(ui.url.closest('label'), el(prefix(kind) + 'timeout').closest('label'));
      if (kind === 'indextts') {
        const {wrapper, input} = field('强制加载文本情感模型（QwenEmotion）', 'checkbox', 'tts-local-indextts-qwen');
        wrapper.dataset.optionHelp = '未勾选时沿用整合包的显存策略；勾选时强制加载 QwenEmotion。修改后需停止并重新启动 MSW 自有服务。';
        wrapper.className = 'msw-tts-check'; ui.qwen = input; advanced.append(wrapper);
      }
      advancedTitle.dataset.optionHelp = '启动等待上限用于等待模型加载；单次等待上限用于一次语音合成，两者独立。';
      const actions = document.createElement('div'); actions.className = 'msw-processing-actions';
      for (const [key, label] of [['check', '检测连接'], ['start', '启动服务'], ['stop', '停止服务']]) {
        const button = key === 'check' ? el(prefix(kind) + 'check') : document.createElement('button');
        button.type = 'button'; button.textContent = t(label);
        if (key !== 'check') button.id = `tts-local-${kind}-${key}`;
        button.onclick = () => void action(kind, key); ui[key] = button; actions.append(button);
      }
      ui.status = el(prefix(kind) + 'status'); ui.status.dataset.serviceStatus = kind;
      ui.progress = document.createElement('progress'); ui.progress.setAttribute('aria-label', t('正在加载模型…')); ui.progress.hidden = true;
      ui.details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = t('启动日志');
      ui.log = document.createElement('pre'); ui.log.className = 'msw-tts-service-log'; ui.details.append(summary, ui.log); ui.details.hidden = true;
      if (kind === 'gpt-sovits') actions.append(el('tts-gpt-scan'));
      box.append(fields, actions, ui.status, ui.progress, advanced, ui.details);
      for (const control of box.querySelectorAll('input, button')) { control.disabled = true; control.dataset.serviceLocked = 'true'; }
      ui.status.textContent = t('正在读取本机 TTS 配置…');
      new MutationObserver(renderCall).observe(ui.status, {childList:true, characterData:true, subtree:true});
    }
    // Move engine fields rather than maintaining duplicate connection controls.
    el('tts-index-connection-fields').remove();
    const gptManagement = el('tts-gpt-management');
    for (const node of [...gptManagement.children]) if (!node.children.length && ['DIV', 'P'].includes(node.tagName)) node.remove();
    for (const key of ['check', 'start', 'stop']) el('tts-local-call-' + key).onclick = () => void action(el('tts-engine').value, key);
    renderCall();
    return {refresh, save, render, renderCall, start: kind => action(kind, 'start'),
      canStart: (kind = 'indextts') => { const s = states.get(kind); return Boolean(s?.configured && s.service_url === el(prefix(kind) + 'url')?.value.trim()); },
      needsStart: (kind = 'indextts') => !ready(states.get(kind))};
  }
  global.MSWTtsServices = Object.freeze({create});
})(window);
