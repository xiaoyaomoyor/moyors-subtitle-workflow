// Qwen voice selection and independent creation. Credentials/reference files stay
// in this page's memory; only the local server stores reusable voice IDs.
(function (global) {
  'use strict';
  global.MSWQwenVoices = {create({el, t, request, recipe, updateScope, playReference, stopReference, generation}) {
    let metadata = {}, currentModel = '', currentNamespace = '', currentType = 'CustomVoice';
    let records = [], loadSequence = 0, timer, polling = false, failures = 0;
    let managed = [], manageSequence = 0, managedContext = '';
    let submitting = false, pending = null, previewSequence = 0;
    const drafts = new Map(), modelDrafts = new Map(), operations = new Map();
    const type = () => el('tts-model-type').value;
    const namespace = () => `${el('tts-region').value}\0${el('tts-key').value}`;
    const context = () => `${namespace()}\0${el('tts-model').value}`;
    const custom = () => type() !== 'CustomVoice';
    const manageType = () => el('tts-manage-model-type').value;
    const manageContext = () => `${namespace()}\0${el('tts-manage-model').value}`;
    const manageRecipe = () => ({provider: 'qwen', region: el('tts-region').value, model_type: manageType(),
      model: el('tts-manage-model').value, voice: '', language_type: 'Auto', instructions: '', optimize_instructions: false});
    const hasKey = () => Boolean(el('tts-key').value.trim() || metadata.regions?.find(row => row.id === el('tts-region').value)?.hasApiKey);
    const active = op => ['queued', 'preparing', 'creating'].includes(op.status);
    function message(text, error = false) {
      el('tts-voice-message').textContent = t(text);
      el('tts-voice-message').classList.toggle('is-error', error);
    }
    function stopPreview() {
      previewSequence++;
      stopReference('qwen');
    }
    function rows() {
      const local = records.map(row => ({...row, id: row.voice, group: t('本机音色')}));
      return custom() ? local : [...(metadata.systemVoices?.[el('tts-model').value] || []).filter(row => !local.some(v => v.id === row.id)), ...local];
    }
    function previewSource() {
      const selected = rows().find(row => row.id === el('tts-voice').value);
      // URLs come only from the built-in official catalog, never registered voice IDs.
      if (selected?.preview_url && /^https:\/\/help-static-aliyun-doc\.aliyuncs\.com\//.test(selected.preview_url)) return {url: selected.preview_url};
      const op = [...operations.values()].find(op => op.context === context() && op.voice === el('tts-voice').value && op.preview);
      return op ? {operation: op} : null;
    }
    function renderPicker() {
      const all = rows(), query = el('tts-voice-search').value.trim().toLocaleLowerCase();
      const filtered = all.filter(row => [row.id, row.name, row.group, row.gender].join(' ').toLocaleLowerCase().includes(query));
      const select = el('tts-voice-select');
      select.replaceChildren(new Option(t(filtered.length ? '请选择音色' : '没有匹配音色'), ''));
      const groups = new Map();
      for (const row of filtered) {
        if (!groups.has(row.group)) {
          const group = document.createElement('optgroup'); group.label = t(row.group); groups.set(row.group, group); select.append(group);
        }
        groups.get(row.group).append(new Option(`${t(row.name)} · ${row.id}${row.gender ? ' · ' + t(row.gender) : ''}`, row.id));
      }
      const id = el('tts-voice').value.trim(), selected = all.find(row => row.id === id);
      select.value = filtered.some(row => row.id === id) ? id : '';
      el('tts-voice-current').textContent = id ? `${t('当前音色')}：${selected ? t(selected.name) + ' · ' : ''}${id}` : t('请选择音色；可在环境配置中创建或登记');
      const audition = el('tts-voice-audition');
      audition.disabled = !previewSource();
      audition.title = t(previewSource() ? '在素材库播放已有试听音频，不发起云端合成' : '此音色暂无已有试听音频');
      el('tts-voice-list-label').textContent = t(custom() ? '本机创建音色' : '系统音色');
      el('tts-voice-catalog-hint').textContent = custom()
        ? t('当前模型的本机音色；创建和管理请前往环境配置。')
        : `${t('当前模型支持')} ${all.length} ${t('个系统音色')} · ${t('可搜索中文名称、音色 ID 和方言')}`;
      updateScope();
    }
    function remember() {
      if (currentModel) drafts.set(`${currentNamespace}\0${currentModel}`, el('tts-voice').value.trim());
      if (currentModel) modelDrafts.set(currentType, currentModel);
    }
    function fillModels(selected) {
      const models = metadata.modelTypes?.[type()] || [];
      el('tts-model').replaceChildren(...models.map(model => new Option(model, model)));
      el('tts-model').value = models.includes(selected) ? selected : models[0] || '';
    }
    function modeView() {
      el('tts-custom-voices').hidden = false;
      el('tts-instruct').hidden = !el('tts-model').value.includes('-instruct-');
      currentModel = el('tts-model').value; currentNamespace = namespace(); currentType = type();
      renderPicker(); renderOperations();
    }
    function changed({mode = false, credentials = false} = {}) {
      remember(); stopPreview(); loadSequence++; records = []; el('tts-voice-search').value = ''; message('');
      if (mode) fillModels(modelDrafts.get(type()));
      const saved = drafts.get(context());
      el('tts-voice').value = credentials && custom() ? '' : saved ?? (custom() ? '' : 'Cherry');
      modeView();
      void refresh();
    }
    async function refresh() {
      if (!hasKey()) { records = []; renderPicker(); return; }
      const key = context(), sequence = ++loadSequence;
      el('tts-voice-refresh').disabled = true;
      try {
        const data = await request('qwen-voices', {action: 'list', provider: {recipe: {...recipe(), voice: ''}, apiKey: el('tts-key').value}});
        if (sequence !== loadSequence || context() !== key) return;
        records = data.voices;
        for (const operation of data.operations) operations.set(operation.id, {...operation, context: key});
        renderPicker(); renderOperations(); failures = 0; schedule();
      } catch (error) { if (sequence === loadSequence) { message(error.message, true); el('tts-voice-catalog-hint').textContent = error.message; } }
      finally { if (sequence === loadSequence) el('tts-voice-refresh').disabled = false; }
    }
    function managementView({fill = false} = {}) {
      if (fill) {
        const old = el('tts-manage-model').value, models = metadata.modelTypes?.[manageType()] || [];
        el('tts-manage-model').replaceChildren(...models.map(model => new Option(model, model)));
        el('tts-manage-model').value = models.includes(old) ? old : models[0] || '';
      }
      el('tts-design-fields').hidden = manageType() !== 'VoiceDesign';
      el('tts-clone-fields').hidden = manageType() !== 'VoiceClone';
      el('tts-voice-create-fields').hidden = manageType() === 'CustomVoice';
      renderOperations();
    }
    async function refreshManagement() {
      const key = manageContext(), sequence = ++manageSequence;
      if (key !== managedContext || !hasKey()) {
        managed = []; managedContext = key;
        el('tts-manage-voice').replaceChildren(new Option(t('选择已登记音色'), ''));
        el('tts-manage-name').value = ''; renderOperations();
      }
      if (!hasKey()) { el('tts-manage-refresh').disabled = false; message('请先在连接设置填写或保存百炼密钥。'); return; }
      el('tts-manage-refresh').disabled = true;
      try {
        const data = await request('qwen-voices', {action: 'list', provider: {recipe: manageRecipe(), apiKey: el('tts-key').value}});
        if (sequence !== manageSequence || key !== manageContext()) return;
        managed = data.voices;
        const selected = el('tts-manage-voice').value;
        el('tts-manage-voice').replaceChildren(new Option(t('选择已登记音色'), ''), ...managed.map(row => new Option(`${row.name} · ${row.voice}`, row.voice)));
        el('tts-manage-voice').value = selected;
        for (const op of data.operations) operations.set(op.id, {...op, context: key});
        renderOperations(); schedule();
      } catch (error) { if (sequence === manageSequence) message(error.message, true); }
      finally { if (sequence === manageSequence) el('tts-manage-refresh').disabled = false; }
    }
    async function manageVoice(action) {
      const key = manageContext(), version = generation();
      const button = el(action === 'register' ? 'tts-voice-register' : 'tts-manage-rename'); button.disabled = true;
      try {
        const voice = action === 'register' ? el('tts-voice-external-id').value.trim() : el('tts-manage-voice').value;
        await request('qwen-voices', {action, voice, name: el('tts-manage-name').value.trim(), provider: {recipe: manageRecipe(), apiKey: el('tts-key').value}});
        if (key !== manageContext() || version !== generation()) return;
        await refreshManagement(); el('tts-manage-voice').value = voice;
        if (key === context()) await refresh();
        message(action === 'register' ? '已登记，可在合成设置搜索选择。' : '本机显示名称已更新。');
      } catch (error) { if (key === manageContext()) message(error.message, true); }
      finally { button.disabled = false; }
    }
    function button(text, callback) {
      const element = document.createElement('button'); element.type = 'button'; element.textContent = t(text);
      element.addEventListener('click', () => void callback()); return element;
    }
    function renderOperations() {
      const visible = [...operations.values()].filter(op => op.context === manageContext()).sort((a, b) => b.created_at - a.created_at);
      const target = el('tts-voice-operations'), scroll = target.scrollTop, fragment = document.createDocumentFragment();
      const states = {queued: '等待创建', preparing: '检查参考音频', creating: '正在创建', succeeded: '已创建', failed: '创建失败', interrupted: '服务中断'};
      for (const op of visible) {
        const card = document.createElement('article'); card.className = 'msw-processing-job'; card.dataset.voiceOperation = op.id;
        const title = document.createElement('strong'); title.textContent = `${op.name} · ${t(states[op.status] || op.status)}`;
        const detail = document.createElement('p'); detail.className = 'msw-processing-hint'; detail.textContent = `${new Date(op.created_at * 1000).toLocaleString()} · ${op.message}`;
        card.append(title, detail);
        if (op.voice) {
          const actions = document.createElement('div'); actions.className = 'msw-processing-actions';
          actions.append(button('选择此记录', () => { el('tts-manage-voice').value = op.voice; el('tts-manage-name').value = managed.find(row => row.voice === op.voice)?.name || op.name; }));
          if (op.preview) actions.append(button('试听音色', () => playPreview(op)));
          card.append(actions);
        }
        fragment.append(card);
      }
      target.replaceChildren(fragment); target.scrollTop = scroll;
      el('tts-voice-history-count').textContent = `(${visible.length})`;
      el('tts-voice-create').disabled = submitting || (!pending && [...operations.values()].some(active));
      el('tts-voice-create').textContent = t(pending ? '确认上次音色提交' : manageType() === 'VoiceClone' ? '上传参考音频并创建' : '创建音色');
    }
    async function playPreview(op) {
      stopPreview(); const sequence = previewSequence, key = manageContext(), version = generation();
      try {
        await playReference('qwen', `${t('音色试听')} · ${op.name || op.voice || ''}`,
          () => request(`qwen-voice-jobs/${op.id}/preview`, null, true),
          () => sequence === previewSequence && key === manageContext() && version === generation());
      } catch (error) { if (sequence === previewSequence) message(error.message, true); }
    }
    async function createVoice() {
      if (submitting) return;
      submitting = true; renderOperations();
      const origin = {context: manageContext(), generation: generation(), voice: el('tts-voice').value};
      try {
        if (!pending) {
          const input = {action: 'create', request_key: global.MSWProject.id('voice'), name: el('tts-voice-name').value.trim(),
            provider: {recipe: manageRecipe(), apiKey: el('tts-key').value}};
          if (!input.name) throw new Error(t('请填写音色名称'));
          if (manageType() === 'VoiceDesign') {
            input.voice_prompt = el('tts-voice-prompt').value.trim(); input.preview_text = el('tts-voice-preview-text').value.trim();
            if (!input.voice_prompt || !input.preview_text) throw new Error(t('请填写音色描述与试听文本'));
          } else {
            const file = el('tts-voice-reference').files[0];
            if (!file || !/\.(wav|mp3|m4a)$/i.test(file.name)) throw new Error(t('请选择 WAV、MP3 或 M4A 参考音频'));
            if (!file.size || file.size > 10 * 1024 * 1024) throw new Error(t('参考文件须小于等于 10 MiB'));
            input.filename = file.name;
            input.audio_base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]);
              reader.onerror = () => reject(new Error(t('无法读取参考音频'))); reader.readAsDataURL(file);
            });
          }
          if (origin.context !== manageContext() || origin.generation !== generation()) return;
          pending = {input, origin};
        }
        const capture = pending;
        const data = await request('qwen-voices', capture.input);
        operations.set(data.operation.id, {...data.operation, context: capture.origin.context}); pending = null;
        el('tts-voice-history').open = true;
        if (capture.origin.context === manageContext()) message(data.operation.message);
        await finishOperation(data.operation, capture.origin.context);
        failures = 0; schedule(0);
      } catch (error) {
        if (error.status && error.status < 500) pending = null;
        message(pending ? `${error.message}；${t('再次点击会查询同一提交，不会重复创建音色')}` : error.message, true);
      } finally { submitting = false; renderOperations(); }
    }
    async function finishOperation(op, key) {
      if (active(op)) return;
      if (op.status === 'succeeded') {
        if (key === manageContext()) await refreshManagement();
        if (key === context()) await refresh();
      }
      if (key === manageContext()) message(op.message, op.status !== 'succeeded');
    }
    function schedule(delay = 800) {
      clearTimeout(timer);
      if ([...operations.values()].some(active)) timer = setTimeout(() => void poll(), delay);
    }
    async function poll() {
      if (polling) return;
      polling = true;
      try {
        for (const old of [...operations.values()].filter(active)) {
          const data = await request(`qwen-voice-jobs/${old.id}`);
          operations.set(old.id, {...data.operation, context: old.context});
          await finishOperation(data.operation, old.context);
        }
        failures = 0; renderOperations(); schedule();
      } catch (error) {
        message(error.message, true); failures++;
        if (failures < 6) schedule(Math.min(10000, 1000 * 2 ** failures));
      } finally { polling = false; }
    }
    el('tts-model-type').addEventListener('change', () => changed({mode: true}));
    el('tts-model').addEventListener('change', () => changed());
    el('tts-voice-search').addEventListener('input', renderPicker);
    el('tts-voice-audition').addEventListener('click', async () => {
      const source = previewSource(); if (!source) return;
      stopPreview();
      const sequence = previewSequence, key = context(), voice = el('tts-voice').value;
      try {
        await playReference('qwen', `${t('音色试听')} · ${rows().find(row => row.id === voice)?.name || voice}`,
          () => source.url || request(`qwen-voice-jobs/${source.operation.id}/preview`, null, true),
          () => sequence === previewSequence && key === context() && voice === el('tts-voice').value);
      } catch (error) { if (sequence === previewSequence) el('tts-voice-catalog-hint').textContent = error.message; }
    });
    el('tts-voice-select').addEventListener('change', () => {
      stopPreview();
      if (el('tts-voice-select').value) el('tts-voice').value = el('tts-voice-select').value;
      remember(); renderPicker();
    });
    el('tts-voice').addEventListener('input', () => { remember(); renderPicker(); });
    el('tts-voice-refresh').addEventListener('click', () => void refresh());
    el('tts-voice-create').addEventListener('click', () => void createVoice());
    el('tts-manage-model-type').addEventListener('change', () => { stopPreview(); managementView({fill: true}); void refreshManagement(); });
    el('tts-manage-model').addEventListener('change', () => { stopPreview(); managementView(); void refreshManagement(); });
    el('tts-manage-refresh').addEventListener('click', () => void refreshManagement());
    el('tts-voice-register').addEventListener('click', () => void manageVoice('register'));
    el('tts-manage-rename').addEventListener('click', () => void manageVoice('rename'));
    el('tts-manage-voice').addEventListener('change', () => { el('tts-manage-name').value = managed.find(row => row.voice === el('tts-manage-voice').value)?.name || ''; });
    el('tts-key').addEventListener('change', () => { changed({credentials: true}); void refreshManagement(); });
    el('tts-engine').addEventListener('change', () => { stopPreview(); if (el('tts-engine').value === 'qwen' && custom()) void refresh(); });
    global.addEventListener('msw:project-changed', () => { stopPreview(); el('tts-voice-reference').value = ''; });
    return {
      configure(data) {
        metadata = data; records = []; loadSequence++; stopPreview();
        el('tts-model-type').value = data.recipe.model_type || 'CustomVoice';
        fillModels(data.recipe.model); el('tts-voice').value = data.recipe.voice;
        modeView(); managementView({fill: true}); remember(); if (el('tts-engine').value === 'qwen') void refresh();
      },
      credentialsChanged: () => { changed({credentials: true}); void refreshManagement(); },
      reopen: () => void refresh(),
      management: () => { managementView({fill: true}); void refreshManagement(); },
      stopPreview,
    };
  }};
})(window);
