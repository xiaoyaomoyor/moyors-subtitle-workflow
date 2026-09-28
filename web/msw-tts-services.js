// Shared local service controls. Only explicit Start or synthesis starts models.
(function (global) {
  'use strict';
  function create({el, t, request, updateScope, connected}) {
    const states = new Map(), controls = new Map(), pending = new Set(), operations = new Map();
    let timer;
    const names = {indextts: 'IndexTTS', 'gpt-sovits': 'GPT-SoVITS'};
    const loading = s => ['checking', 'loading'].includes(s?.state);
    const ready = s => ['ready', 'external'].includes(s?.state);
    function render(kind, state) {
      const previous = states.get(kind); states.set(kind, state);
      const ui = controls.get(kind), wait = pending.has(kind) || loading(state);
      const operation = operations.get(kind);
      ui.status.textContent = t(operation ? operation === 'pick' ? '正在打开目录选择窗口…' : operation === 'check' ? '正在验证连接…' : operation === 'start' ? '正在启动服务…' : '正在停止服务…' : state.message || '尚未检测服务');
      ui.status.setAttribute('aria-busy', String(wait));
      ui.status.classList.toggle('is-error', ['failed', 'conflict'].includes(state.state));
      ui.log.textContent = (state.logs || []).join('\n');
      ui.details.hidden = !state.logs?.length;
      ui.progress.hidden = !loading(state);
      ui.start.textContent = t(loading(state) ? '正在加载模型…' : '启动服务');
      ui.start.disabled = wait || ready(state) || !state.configured;
      ui.check.disabled = wait;
      ui.stop.hidden = !state.owned && !loading(state);
      ui.stop.textContent = t(state.owned ? '停止服务' : '取消启动');
      ui.stop.disabled = pending.has(kind);
      for (const input of ui.fields.querySelectorAll('input, button')) input.disabled = wait || state.owned;
      if (ui.qwen) ui.qwen.disabled = wait || state.owned;
      if (kind === 'indextts') {
        el('tts-local-call-status').parentElement.hidden = !state.configured && !state.owned;
        el('tts-local-call-status').textContent = `${names[kind]} · ${t(state.message || '尚未检测服务')}`;
        el('tts-local-call-start').hidden = ready(state);
        el('tts-local-call-start').disabled = ui.start.disabled;
        if (ready(state) && !ready(previous)) connected();
      }
      if (kind === 'gpt-sovits' && el('tts-gpt-local-call-status')) {
        el('tts-gpt-local-call-status').parentElement.hidden = !state.configured && !state.owned;
        el('tts-gpt-local-call-status').textContent = t(state.message || '尚未检测服务');
        el('tts-gpt-local-call-start').hidden = ready(state);
        el('tts-gpt-local-call-start').disabled = ui.start.disabled;
      }
      updateScope();
      clearTimeout(timer);
      if ([...states.values()].some(loading)) timer = setTimeout(() => void refresh(), 900);
    }
    function values(kind) {
      const ui = controls.get(kind);
      return {directory: ui.directory.value.trim(), port: Number(ui.port.value),
        startup_timeout: Number(ui.timeout.value), qwen_emo: Boolean(ui.qwen?.checked)};
    }
    async function refresh(fill = false) {
      for (const kind of Object.keys(names)) {
        try {
          const {service} = await request(`tts-local-service?engine=${kind}`);
          if (fill) {
            const ui = controls.get(kind), cfg = service.settings;
            ui.directory.value = cfg.directory; ui.python.value = cfg.python || t('选择目录后自动检测');
            ui.port.value = String(cfg.port); ui.timeout.value = String(cfg.startup_timeout);
            if (ui.qwen) ui.qwen.checked = cfg.qwen_emo;
          }
          render(kind, service);
        } catch (error) { controls.get(kind).status.textContent = error.message; }
      }
    }
    async function save(kind) {
      const {service} = await request('tts-local-service', {engine: kind, action: 'save', settings: values(kind)});
      const ui = controls.get(kind);
      ui.directory.value = service.settings.directory; ui.python.value = service.settings.python;
      if (service.configured) {
        const url = el(kind === 'indextts' ? 'tts-index-url' : 'tts-gpt-url');
        if (url) { url.value = service.service_url; url.dispatchEvent(new Event('change', {bubbles: true})); }
      }
      render(kind, service);
      return service;
    }
    async function action(kind, action) {
      if (pending.has(kind)) return;
      if (action === 'stop' && !global.confirm(t('停止服务会取消此引擎正在处理和等待的任务，是否继续？'))) return;
      pending.add(kind);operations.set(kind,action);render(kind,states.get(kind)||{});
      let failure = '';
      try {
        if (action === 'start' || action === 'check') await save(kind);
        const {service} = await request('tts-local-service', {engine: kind, action, confirm: action === 'stop'});
        render(kind, service);
      } catch (error) { failure = error.message; }
      finally {
        pending.delete(kind);operations.delete(kind);render(kind,states.get(kind)||{}); await refresh();
        if (failure) { controls.get(kind).status.textContent = failure; controls.get(kind).status.classList.add('is-error'); }
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
      const ui = {fields}; controls.set(kind, ui);
      for (const [key, label, type] of [['directory','安装位置','text'], ['python','内置 Python','text'],
        ['port','服务端口','number'], ['timeout','启动等待上限（秒）','number']]) {
        const {wrapper, input} = field(label, type, `tts-local-${kind}-${key}`); ui[key] = input;
        if (key === 'directory') {
          const choose = document.createElement('button'); choose.type = 'button'; choose.textContent = t('选择文件夹');
          choose.onclick = async () => {
            if(pending.has(kind))return;
            pending.add(kind);operations.set(kind,'pick');render(kind,states.get(kind)||{});
            choose.disabled=true;choose.textContent=t('正在打开…');let outcome='',failed=false;
            try {
              const data=await request('tts-local-service',{engine:kind,action:'pick'});
              if(data.directory){input.value=data.directory;await save(kind);}
              else outcome=t('已取消目录选择');
            }catch(error){outcome=error.message;failed=true;}
            finally{
              pending.delete(kind);operations.delete(kind);choose.textContent=t('选择文件夹');
              render(kind,states.get(kind)||{});
              if(outcome){ui.status.textContent=outcome;ui.status.classList.toggle('is-error',failed);}
            }
          };
          const row = document.createElement('span'); row.className = 'msw-tts-directory-input';
          row.append(input, choose); wrapper.append(row);
        }
        if (key === 'python') input.readOnly = true;
        if (key === 'port') { input.min = '1024'; input.max = '65535'; input.value = kind === 'indextts' ? '7860' : '9880'; }
        if (key === 'timeout') { input.min = '30'; input.max = '3600'; input.value = '600'; }
        fields.append(wrapper);
      }
      box.append(fields);
      if (kind === 'indextts') {
        const {wrapper, input} = field('强制加载文本情感模型（QwenEmotion）', 'checkbox', 'tts-local-indextts-qwen');
        wrapper.dataset.optionHelp = '未勾选时沿用整合包的显存策略；勾选时强制加载 QwenEmotion。修改后需停止并重新启动 MSW 自有服务。';
        wrapper.className = 'msw-tts-check'; ui.qwen = input; box.append(wrapper);
      }
      const actions = document.createElement('div'); actions.className = 'msw-processing-actions';
      for (const [key, label] of [['check', '检测服务'], ['start', '启动服务'], ['stop', '停止服务']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = t(label);
        button.id = `tts-local-${kind}-${key}`; button.onclick = () => void action(kind, key);
        ui[key] = button; actions.append(button);
      }
      ui.status = document.createElement('p'); ui.status.className = 'msw-processing-message'; ui.status.setAttribute('role','status');
      ui.status.id = `tts-local-${kind}-status`; box.append(actions, ui.status);
      ui.progress = document.createElement('progress'); ui.progress.setAttribute('aria-label', t('正在加载模型…'));
      ui.progress.hidden = true; box.append(ui.progress);
      ui.details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = t('启动日志');
      ui.log = document.createElement('pre'); ui.log.className = 'msw-tts-service-log';
      ui.details.append(summary, ui.log); ui.details.hidden = true; box.append(ui.details);
    }
    el('tts-local-call-start').onclick = () => void action('indextts', 'start');
    return {refresh, save, render, start: kind => action(kind, 'start'),
      canStart: (kind = 'indextts') => { const s = states.get(kind); return Boolean(s?.configured && s.service_url === el(kind === 'indextts' ? 'tts-index-url' : 'tts-gpt-url')?.value.trim()); },
      needsStart: (kind = 'indextts') => !ready(states.get(kind))};
  }
  global.MSWTtsServices = Object.freeze({create});
})(window);
