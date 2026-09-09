// IndexTTS controls. Reference bytes and connection settings remain on this computer.
(function (global) {
  'use strict';
  function create({el, t, request, updateScope, generation, playReference, stopReference}) {
    let cap = null, capUrl = '', refs = [], presets = {}, busy = false, sequence = 0, uploadKind = 'speaker';
    let previewSequence = 0;
    let durationFactor = 1, statusText = '', connectionFailure = false;
    const officialRefs = new Map();
    const fields = {
      do_sample: ['随机采样 · do_sample', true],
      top_p: ['Top P', 0.8, 0, 1, 0.01], top_k: ['Top K（0 表示不限）', 30, 0, 100, 1],
      temperature: ['温度', 0.8, 0.1, 2, 0.1], length_penalty: ['长度惩罚', 0, -2, 2, 0.1],
      num_beams: ['束搜索数', 3, 1, 10, 1], repetition_penalty: ['重复惩罚', 10, 0.1, 20, 0.1],
      max_mel_tokens: ['最大音频 Token 数', 1500, 50, 1815, 1],
      max_text_tokens_per_segment: ['每段最大文本 Token 数', 120, 20, 600, 2],
    };
    const lang = {ZH: '中文', EN: 'English', JA: '日本語', ES: 'Español', AR: 'العربية'};
    const value = id => el('tts-index-' + id).value;
    const active = () => el('tts-engine').value === 'indextts' || (el('editor-settings-modal').classList.contains('show') && el('tts-environment-engine').value === 'indextts');
    const connection = () => ({service_url: value('url').trim(), timeout: Number(value('timeout'))});
    function message(text, error = false) {
      el('tts-index-status').textContent = t(text);
      el('tts-index-status').classList.toggle('is-error', error);
      statusText = text;
      el('tts-index-call-status').textContent = error ? text : '';
      el('tts-index-call-status').hidden = !error;
    }
    function options(id, rows, placeholder, current = value(id)) {
      el('tts-index-' + id).replaceChildren(new Option(t(placeholder), ''), ...rows.map(row => new Option(row.label, row.id)));
      el('tts-index-' + id).value = current;
    }
    function renderReferences(selected = {}) {
      const rows = refs.map(ref => ({id: ref.id, label: `${ref.name} · ${(ref.sample_count / ref.sample_rate).toFixed(1)} s`}));
      if (selected.speaker !== undefined) el('tts-index-speaker').value = selected.speaker;
      options('emotion-ref', rows, '请选择或上传情感参考', selected.emotion ?? value('emotion-ref'));
      renderPicker(); render();
    }
    function renderPicker() {
      const official = value('voice-source') === 'official', query = value('voice-search').trim().toLocaleLowerCase();
      const matches = row => row.label.toLocaleLowerCase().includes(query);
      el('tts-index-official-field').hidden = !official;
      el('tts-index-local-field').hidden = official;
      const rows = (cap?.voices || []).map(row => ({id: String(row.index), label: `${row.name} · ${lang[row.language] || row.language} · ${row.language}`}));
      const selected = [...officialRefs].find(([, ref]) => ref === value('speaker'))?.[0] || '';
      options('example', rows.filter(matches), '选择官方示例音色', selected);
      options('local-voice', refs.map(ref => ({id: ref.id, label: ref.name})).filter(matches), '请选择或上传参考音频', value('speaker'));
    }
    function renderPresets() {
      options('preset', Object.keys(presets).map(name => ({id: name, label: name})), '选择已保存预设');
      options('preset-manage', Object.keys(presets).map(name => ({id: name, label: name})), '选择已保存预设');
      options('server-preset', (cap?.presets || []).map(name => ({id: name, label: name})), '选择服务预设');
    }
    function renderCapability() {
      renderPicker();
      options('emotion-example', (cap?.emotion_examples || []).map(row => ({id: String(row.index), label: row.name})), '选择情感示例');
      el('tts-index-emotion-mode').querySelector('[value="text"]').disabled = !cap?.text_emotion;
      el('tts-index-emotion-capability').textContent = t(cap?.text_emotion
        ? '文本情感模型已加载，可以使用实验性情感描述。'
        : '文本情感需 IndexTTS 加载 QwenEmotion。可用 --qwen_emo 启动该服务后重新检测；MSWE 不会自动重启服务。');
      for (const key of ['max_mel_tokens', 'max_text_tokens_per_segment']) el('tts-index-' + key).max = cap?.[key] || fields[key][3];
      renderPresets(); render();
    }
    function ready() {
      return !busy && Boolean(cap && capUrl === connection().service_url && value('speaker'))
        && (value('emotion-mode') !== 'audio' || Boolean(value('emotion-ref')))
        && (value('emotion-mode') !== 'text' || Boolean(cap?.text_emotion));
    }
    function render() {
      const mode = value('emotion-mode');
      el('tts-index-controls').disabled = busy;
      el('tts-index-check').disabled = busy;
      el('tts-index-url').disabled = busy; el('tts-index-timeout').disabled = busy;
      for (const input of el('tts-environment-indextts').querySelectorAll('input, select, button')) input.disabled = busy;
      for (const kind of ['audio', 'vector']) el('tts-index-emotion-' + kind).hidden = mode !== kind;
      el('tts-index-emotion-text-field').hidden = mode !== 'text';
      el('tts-index-emotion-weight-field').hidden = mode === 'follow';
      el('tts-index-random-field').hidden = !['vector', 'text'].includes(mode);
      el('tts-index-speed-value').value = `${Math.round(100 / durationFactor)}%`;
      el('tts-index-weight-value').value = Number(value('weight')).toFixed(2);
      for (let i = 0; i < 8; i++) el(`tts-index-vector-${i}-value`).value = Number(value(`vector-${i}`)).toFixed(2);
      for (const [kind, id] of [['speaker', 'speaker'], ['emotion', 'emotion-ref']]) el(`tts-index-${kind}-preview`).disabled = !value(id);
      const speaker = refs.find(ref => ref.id === value('speaker'));
      el('tts-index-speaker-info').textContent = speaker ? `${t('当前音色')}：${speaker.name} · ${(speaker.sample_count / speaker.sample_rate).toFixed(1)} s` : t('请选择音色');
      el('tts-index-server-preset-load').disabled = busy || !value('server-preset') || !cap;
      updateScope();
    }
    function recipe() {
      return {provider: 'indextts', model: 'index-tts-2.5', voice: refs.find(ref => ref.id === value('speaker'))?.name || '',
        speaker_ref: value('speaker'), emotion_ref: value('emotion-ref'), language_type: value('language'),
        duration_factor: durationFactor, emotion_mode: value('emotion-mode'), emotion_weight: Number(value('weight')),
        emotion_vector: Array.from({length: 8}, (_, i) => Number(value(`vector-${i}`))),
        emotion_text: value('emotion-text').trim(), emotion_random: el('tts-index-random').checked,
        ...Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key, typeof spec[1] === 'boolean'
          ? el('tts-index-' + key).checked : Number(value(key))]))};
    }
    function apply(recipe) {
      for (const [id, key] of Object.entries({speaker: 'speaker_ref', 'emotion-ref': 'emotion_ref', language: 'language_type',
        'emotion-mode': 'emotion_mode', weight: 'emotion_weight', 'emotion-text': 'emotion_text'})) {
        if (recipe[key] !== undefined) el('tts-index-' + id).value = String(recipe[key]);
      }
      durationFactor = Number(recipe.duration_factor) || 1;
      el('tts-index-speed').value = String(Math.round(100 / durationFactor));
      el('tts-index-random').checked = Boolean(recipe.emotion_random);
      for (let i = 0; i < 8; i++) el(`tts-index-vector-${i}`).value = String(recipe.emotion_vector?.[i] || 0);
      for (const [key, spec] of Object.entries(fields)) {
        if (typeof spec[1] === 'boolean') el('tts-index-' + key).checked = recipe[key] ?? spec[1];
        else el('tts-index-' + key).value = String(recipe[key] ?? spec[1]);
      }
      el('tts-index-voice-source').value = [...officialRefs.values()].includes(value('speaker')) || !value('speaker') ? 'official' : 'local';
      renderPicker(); render();
    }
    async function operation(body, complete) {
      if (busy) return;
      const token = ++sequence, project = generation();
      busy = true; render(); message(body.action === 'check' ? '正在检测 IndexTTS 服务…' : '正在处理参考音频或预设…');
      try {
        const data = await request('index-tts', {...connection(), ...body});
        if (token !== sequence || project !== generation()) return;
        complete(data);
      } catch (error) {
        if (token === sequence && project === generation()) { if (body.action === 'check') connectionFailure = true; message(error.message, true); }
      } finally { if (token === sequence) { busy = false; render(); } }
    }
    function stopPreview() {
      previewSequence++;
      stopReference('indextts');
    }
    async function preview(id) {
      stopPreview();
      const token = previewSequence, project = generation();
      try {
        await playReference('indextts', `${t('试听参考')} · ${refs.find(ref => ref.id === id)?.name || ''}`,
          () => request(`index-reference?id=${encodeURIComponent(id)}`, null, true),
          () => token === previewSequence && project === generation() && active());
      } catch (error) { if (token === previewSequence && project === generation()) message(error.message, true); }
    }
    function invalidate() { sequence++; busy = false; stopPreview(); render(); }
    function configure(data) {
      invalidate();
      if (!data) { cap = null; message('本机服务未提供 IndexTTS 接口，请重启编辑器服务。', true); return; }
      el('tts-index-url').value = data.service_url; el('tts-index-timeout').value = String(data.timeout);
      cap = data.capability; capUrl = cap ? data.service_url : ''; refs = data.references || []; presets = data.presets || {}; connectionFailure = false;
      renderReferences(); apply(data.recipe || {}); renderCapability();
      message(cap ? 'IndexTTS 服务已连接。' : '请先连接并检测本机服务。');
    }
    for (const [key, spec] of Object.entries(fields)) {
      const label = document.createElement('label'); label.className = 'msw-processing-field';
      const title = document.createElement('span'); title.textContent = t(spec[0]);
      const input = document.createElement('input'); input.id = 'tts-index-' + key;
      if (typeof spec[1] === 'boolean') { input.type = 'checkbox'; input.checked = spec[1]; }
      else { input.type = 'number'; [input.value, input.min, input.max, input.step] = spec.slice(1).map(String); }
      label.append(title, input); el('tts-index-advanced-fields').append(label);
    }
    ['喜', '怒', '哀', '惧', '厌恶', '低落', '惊喜', '平静'].forEach((name, i) => {
      const label = document.createElement('label'); label.className = 'msw-processing-field';
      const title = document.createElement('span'); title.append(t(name) + ' · ');
      const output = document.createElement('output'); output.id = `tts-index-vector-${i}-value`; output.value = '0.00';
      const input = document.createElement('input'); input.id = `tts-index-vector-${i}`;
      input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '.05'; input.value = '0';
      title.append(output); label.append(title, input); el('tts-index-emotion-vector').append(label);
    });
    el('tts-index-fields').addEventListener('input', render);
    el('tts-index-fields').addEventListener('change', render);
    el('tts-environment-indextts').addEventListener('input', render);
    el('tts-environment-indextts').addEventListener('change', render);
    el('tts-index-speed').addEventListener('input', () => { durationFactor = 100 / Number(value('speed')); render(); });
    el('tts-index-voice-source').addEventListener('change', () => { el('tts-index-voice-search').value = ''; renderPicker(); });
    el('tts-index-voice-search').addEventListener('input', renderPicker);
    el('tts-index-local-voice').addEventListener('change', () => {
      if (!value('local-voice')) return;
      stopPreview(); el('tts-index-speaker').value = value('local-voice'); render();
    });
    el('tts-index-url').addEventListener('input', () => { cap = null; capUrl = ''; renderCapability(); message('地址已变更，请重新检测。'); });
    function check() {
      if (busy) return;
      cap = null; capUrl = ''; officialRefs.clear(); renderCapability();
      connectionFailure = false;
      return operation({action: 'check'}, data => {
        cap = data.capability; capUrl = data.service_url; el('tts-index-url').value = capUrl;
        renderCapability(); el('tts-index-connection').open = false;
        message(`IndexTTS 已连接 · ${cap.voices.length} 个官方示例音色`);
      });
    }
    el('tts-index-check').addEventListener('click', () => void check());
    for (const [id, kind] of [['example', 'speaker'], ['emotion-example', 'emotion']]) {
      el('tts-index-' + id).addEventListener('change', () => {
        if (!value(id)) return;
        stopPreview();
        const index = value(id);
        void operation({action: 'example', index: Number(index), kind}, data => {
          if (kind === 'speaker') officialRefs.set(index, data.reference.id);
          refs = data.references; renderReferences({[kind]: data.reference.id}); message('参考音频已保存到本机。');
        });
      });
    }
    for (const [kind, id] of [['speaker', 'speaker'], ['emotion', 'emotion-ref']]) {
      el(`tts-index-${kind}-upload`).addEventListener('click', () => { uploadKind = kind; el('tts-index-reference-file').click(); });
      el(`tts-index-${kind}-preview`).addEventListener('click', () => void preview(value(id)));
      el('tts-index-' + id).addEventListener('change', stopPreview);
    }
    el('tts-index-reference-file').addEventListener('change', async event => {
      const file = event.target.files[0], kind = uploadKind, project = generation(), token = sequence;
      event.target.value = '';
      if (!file || busy) return;
      if (!file.size || file.size > 32 * 1024 * 1024) { message('参考音频须小于等于 32 MiB。', true); return; }
      try {
        const encoded = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error(t('无法读取音频文件'))); reader.readAsDataURL(file);
        });
        if (project !== generation() || token !== sequence || !active()) return;
        stopPreview();
        await operation({action: 'upload', filename: file.name, audio_base64: encoded}, data => {
          if (kind === 'speaker') el('tts-index-voice-source').value = 'local';
          refs = data.references; renderReferences({[kind]: data.reference.id}); message('参考音频已保存到本机。');
        });
      } catch (error) { if (project === generation()) message(error.message, true); }
    });
    el('tts-index-preset-save').addEventListener('click', () => {
      const name = value('preset-name').trim();
      if (presets[name] && !global.confirm(t('覆盖此本机配音预设？'))) return;
      void operation({action: 'save_preset', name, recipe: recipe()}, data => {
        presets = data.presets; renderPresets(); el('tts-index-preset').value = name; message('完整配音参数已保存为本机预设。');
      });
    });
    el('tts-index-preset').addEventListener('change', () => {
      const saved = presets[value('preset')]; if (saved) { stopPreview(); apply(saved); message('已应用本机预设。'); }
    });
    for (const action of ['rename', 'delete']) el(`tts-index-preset-${action}`).addEventListener('click', () => {
      const name = value('preset-manage');
      if (!name) { message('请先选择要管理的预设。', true); return; }
      if (action === 'delete' && !global.confirm(t(`移除本机预设“${name}”？参考音频和已生成素材会保留。`))) return;
      const newName = value('preset-name').trim();
      void operation({action: `${action}_preset`, name, new_name: newName}, data => {
        presets = data.presets; renderPresets(); message(action === 'rename' ? '预设已重命名。' : '本机预设已移除。');
      });
    });
    el('tts-index-preset-manage').addEventListener('change', () => { el('tts-index-preset-name').value = value('preset-manage'); });
    el('tts-index-server-preset-load').addEventListener('click', () => {
      stopPreview();
      void operation({action: 'server_preset', name: value('server-preset'), recipe: recipe()}, data => {
        refs = data.references; renderReferences(); apply(data.recipe); el('tts-index-preset-name').value = value('server-preset'); message('已载入服务预设，保留当前语言和语速。');
      });
    });
    global.addEventListener('msw:project-changed', invalidate);
    return {configure, recipe, connection, ready, stopPreview, invalidate, check,
      isBusy: () => busy,
      connected: () => Boolean(cap && capUrl === connection().service_url),
      problem: () => connectionFailure ? statusText : cap ? '' : busy ? '正在检测 IndexTTS 连接…' : 'IndexTTS 尚未连接，请在环境配置中检测服务。'};
  }
  global.MSWIndexTts = Object.freeze({create});
})(window);
