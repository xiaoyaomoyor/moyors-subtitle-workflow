// Qwen voice selection and independent creation. Credentials/reference files stay
// in this page's memory; only the local server stores reusable voice IDs.
(function (global) {
  'use strict';
  global.MSWQwenVoices = {create({el, t, request, recipe, updateScope, stopAssetPreview, pauseMedia, generation}) {
    let metadata = {}, currentModel = '', currentNamespace = '', currentType = 'CustomVoice';
    let records = [], loadSequence = 0, timer, polling = false, failures = 0;
    let submitting = false, pending = null, previewUrl = null, previewSequence = 0;
    const drafts = new Map(), modelDrafts = new Map(), operations = new Map(), origins = new Map();
    const type = () => el('tts-model-type').value;
    const namespace = () => `${el('tts-region').value}\0${el('tts-key').value}`;
    const context = () => `${namespace()}\0${el('tts-model').value}`;
    const custom = () => type() !== 'CustomVoice';
    const active = op => ['queued', 'preparing', 'creating'].includes(op.status);
    function message(text, error = false) {
      el('tts-voice-message').textContent = t(text);
      el('tts-voice-message').classList.toggle('is-error', error);
    }
    function stopPreview() {
      previewSequence++;
      const audio = el('tts-voice-preview'); audio.pause(); audio.removeAttribute('src'); audio.load(); audio.hidden = true;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    function rows() {
      return custom() ? records.map(row => ({...row, id: row.voice, group: t('本机创建音色')}))
        : (metadata.systemVoices?.[el('tts-model').value] || []);
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
      el('tts-voice-current').textContent = id ? `${t('当前音色')}：${selected ? t(selected.name) + ' · ' : ''}${id}` : t('请先选择、创建或填写音色 ID');
      el('tts-voice-list-label').textContent = t(custom() ? '本机创建音色' : '系统音色');
      el('tts-voice-catalog-hint').textContent = custom()
        ? t('仅列出当前模型、地域和密钥配置下在本机创建的音色；可手动填写已有百炼音色 ID。')
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
      el('tts-custom-voices').hidden = !custom();
      el('tts-design-fields').hidden = type() !== 'VoiceDesign';
      el('tts-clone-fields').hidden = type() !== 'VoiceClone';
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
      if (custom()) void refresh();
    }
    async function refresh() {
      if (!custom()) return;
      const key = context(), sequence = ++loadSequence;
      el('tts-voice-refresh').disabled = true;
      try {
        const data = await request('qwen-voices', {action: 'list', provider: {recipe: {...recipe(), voice: ''}, apiKey: el('tts-key').value}});
        if (sequence !== loadSequence || context() !== key) return;
        records = data.voices;
        for (const operation of data.operations) operations.set(operation.id, {...operation, context: key});
        renderPicker(); renderOperations(); failures = 0; schedule();
      } catch (error) { if (sequence === loadSequence) message(error.message, true); }
      finally { if (sequence === loadSequence) el('tts-voice-refresh').disabled = false; }
    }
    function button(text, callback) {
      const element = document.createElement('button'); element.type = 'button'; element.textContent = t(text);
      element.addEventListener('click', () => void callback()); return element;
    }
    function renderOperations() {
      const visible = [...operations.values()].filter(op => op.context === context()).sort((a, b) => b.created_at - a.created_at);
      const target = el('tts-voice-operations'), scroll = target.scrollTop, fragment = document.createDocumentFragment();
      const states = {queued: '等待创建', preparing: '检查参考音频', creating: '正在创建', succeeded: '已创建', failed: '创建失败', interrupted: '服务中断'};
      for (const op of visible) {
        const card = document.createElement('article'); card.className = 'msw-processing-job'; card.dataset.voiceOperation = op.id;
        const title = document.createElement('strong'); title.textContent = `${op.name} · ${t(states[op.status] || op.status)}`;
        const detail = document.createElement('p'); detail.className = 'msw-processing-hint'; detail.textContent = `${new Date(op.created_at * 1000).toLocaleString()} · ${op.message}`;
        card.append(title, detail);
        if (op.voice) {
          const actions = document.createElement('div'); actions.className = 'msw-processing-actions';
          actions.append(button('使用此音色', () => { el('tts-voice').value = op.voice; remember(); renderPicker(); message('已选择音色，可开始字幕配音'); }));
          if (op.preview) actions.append(button('试听音色', () => playPreview(op)));
          card.append(actions);
        }
        fragment.append(card);
      }
      target.replaceChildren(fragment); target.scrollTop = scroll;
      el('tts-voice-history-count').textContent = `(${visible.length})`;
      el('tts-voice-create').disabled = submitting || (!pending && [...operations.values()].some(active));
      el('tts-voice-create').textContent = t(pending ? '确认上次音色提交' : type() === 'VoiceClone' ? '上传参考音频并创建' : '创建音色');
    }
    async function playPreview(op) {
      stopPreview(); const sequence = previewSequence, key = context(), version = generation();
      try {
        const blob = await request(`qwen-voice-jobs/${op.id}/preview`, null, true);
        if (sequence !== previewSequence || key !== context() || version !== generation()) return;
        previewUrl = URL.createObjectURL(blob);
        const audio = el('tts-voice-preview'); audio.src = previewUrl; audio.hidden = false;
        stopAssetPreview(); pauseMedia(); await audio.play();
      } catch (error) { if (sequence === previewSequence) message(error.message, true); }
    }
    async function createVoice() {
      if (submitting) return;
      submitting = true; renderOperations();
      const origin = {context: context(), generation: generation(), voice: el('tts-voice').value};
      try {
        if (!pending) {
          const input = {action: 'create', request_key: global.MSWProject.id('voice'), name: el('tts-voice-name').value.trim(),
            provider: {recipe: {...recipe(), voice: ''}, apiKey: el('tts-key').value}};
          if (!input.name) throw new Error(t('请填写音色名称'));
          if (type() === 'VoiceDesign') {
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
          if (origin.context !== context() || origin.generation !== generation()) return;
          pending = {input, origin};
        }
        const capture = pending;
        const data = await request('qwen-voices', capture.input);
        origins.set(data.operation.id, capture.origin);
        operations.set(data.operation.id, {...data.operation, context: capture.origin.context}); pending = null;
        el('tts-voice-history').open = true;
        if (capture.origin.context === context()) message(data.operation.message);
        await finishOperation(data.operation, capture.origin.context);
        failures = 0; schedule(0);
      } catch (error) {
        if (error.status && error.status < 500) pending = null;
        message(pending ? `${error.message}；${t('再次点击会查询同一提交，不会重复创建音色')}` : error.message, true);
      } finally { submitting = false; renderOperations(); }
    }
    async function finishOperation(op, key) {
      if (active(op)) return;
      const origin = origins.get(op.id); origins.delete(op.id);
      if (key !== context()) return;
      if (op.status === 'succeeded') {
        await refresh();
        if (origin && el('tts-engine').value === 'qwen' && origin.context === context() && origin.generation === generation() && origin.voice === el('tts-voice').value) {
          el('tts-voice').value = op.voice; remember(); renderPicker();
        }
      }
      message(op.message, op.status !== 'succeeded');
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
    el('tts-voice-select').addEventListener('change', () => {
      if (el('tts-voice-select').value) el('tts-voice').value = el('tts-voice-select').value;
      remember(); renderPicker();
    });
    el('tts-voice').addEventListener('input', () => { remember(); renderPicker(); });
    el('tts-voice-refresh').addEventListener('click', () => void refresh());
    el('tts-voice-create').addEventListener('click', () => void createVoice());
    el('tts-key').addEventListener('change', () => changed({credentials: true}));
    el('tts-engine').addEventListener('change', () => { stopPreview(); if (el('tts-engine').value === 'qwen' && custom()) void refresh(); });
    global.addEventListener('msw:project-changed', () => { stopPreview(); el('tts-voice-reference').value = ''; });
    document.addEventListener('play', event => {
      if (event.target === el('tts-voice-preview')) { stopAssetPreview(); pauseMedia(); }
      else if (['player', 'asset-audio'].includes(event.target.id)) el('tts-voice-preview').pause();
    }, true);
    return {
      configure(data) {
        metadata = data; records = []; loadSequence++; stopPreview();
        el('tts-model-type').value = data.recipe.model_type || 'CustomVoice';
        fillModels(data.recipe.model); el('tts-voice').value = data.recipe.voice;
        modeView(); remember(); if (custom() && el('tts-engine').value === 'qwen') void refresh();
      },
      credentialsChanged: () => changed({credentials: true}),
      reopen: () => { if (custom()) void refresh(); },
    };
  }};
})(window);
