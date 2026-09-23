// Local ASR additions use the MSW queue form and existing tools navigation.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const launcher = window.MSWLauncher;
  const labels = [["FireRed 标点","FireRed punctuation"],["不使用","None"],["使用 ct-punc（需下载）","ct-punc (download required)"],["识别后补齐字词时间码","Fill word timestamps after ASR"],["不额外对齐","No additional alignment"],["只为本次识别的原声字幕补齐时间码，不修改已有译文副轨。","Align only the newly recognized source text; existing translations are preserved."],["扫描对齐模型","Scan alignment models"],["下载所选对齐模型","Download selected aligner"],["取消下载","Cancel download"],["字词时间码对齐","Word timestamp alignment"],["字幕工程或 SRT","Subtitle project or SRT"],["目标字幕轨","Target subtitle track"],["主字幕（原声）","Main (source speech)"],["对应媒体（主字幕可留空使用工程媒体）","Matching media (main may use project media)"],["音频轨序号（从 0 起；留空沿用工程）","Audio stream (0-based; blank uses project)"],["对齐模型","Alignment model"],["处理方式","Mode"],["仅补齐缺失时间码","Fill missing timestamps"],["重新生成并覆盖已有时间码","Regenerate and replace existing timestamps"],["开始对齐","Start alignment"],["取消对齐","Cancel alignment"],["字幕对比工具","Subtitle comparison tools"],["在浏览器本地读取文件，不上传字幕。对比不会修改原文件。","Files are read locally in your browser, without upload or modification."],["转写文本对比","Transcription comparison"],["字词时间码查看与对比","View and compare word timestamps"],["字词时间码","Word timestamps"],["字幕对比","Subtitle comparison"],["运行环境版本与组件","Runtime version and components"],["刷新组件清单","Refresh component inventory"],["默认只补齐主字幕的缺失字词时间码，输出新工程。副字幕／叠加字幕必须明确选择与文本匹配的音频；覆盖已有时间码需选择“重新生成”。","Fill missing timestamps in the main track and save a new project. Secondary and overlay tracks require explicitly matched audio. Choose Regenerate to replace existing timestamps."]];
  function localize() {
    const en = document.documentElement.lang.startsWith('en');
    document.querySelectorAll('[data-msw5]').forEach(node => { node.textContent = labels[Number(node.dataset.msw5)][en ? 1 : 0]; });
  }
  document.addEventListener('mswlanguage', localize);
  localize();
  const call = (method, payload = {}) => launcher.callBackend(method, payload);
  async function inventory() {
    const result = await call('get_local_runtime_inventory');
    const data = result.inventory;
    $('runtimeInventory').textContent = !data ? result.error || '暂时无法读取组件清单' :
      `运行环境：${data.runtimeVersionInstalled || '未安装'} / 所需 ${data.runtimeVersionExpected}\n${data.detail || ''}\n` +
      (data.components || []).map(item => `${item.installed ? '✓' : '—'} ${item.name}`).join('\n');
  }
  $('refreshRuntimeInventory').onclick = () => void inventory();
  $('refreshLocalRuntime').addEventListener('click', () => void inventory());
  const configFields = ['fireredPunc', 'alignmentModel', 'alignmentModelPath'];
  try {
    const saved = JSON.parse(localStorage.getItem('msw.local-asr-options') || '{}');
    for (const key of configFields) if (typeof saved[key] === 'string') $(key).value = saved[key];
  } catch { /* Older settings remain usable. */ }
  for (const key of configFields) $(key).addEventListener('change', () => {
    localStorage.setItem('msw.local-asr-options', JSON.stringify(Object.fromEntries(configFields.map(id => [id, $(id).value]))));
  });
  function localVisibility() {
    const local = $('provider').value === 'local';
    $('fireredPunc').closest('.field').classList.toggle('hidden', !local || $('model').value !== 'firered-asr2-ctc-local');
  }
  $('provider').addEventListener('change', localVisibility);
  $('model').addEventListener('change', localVisibility);
  async function models() {
    const result = await call('get_alignment_models');
    $('alignmentModelsStatus').textContent = result.ok ? (result.models || []).map(model => `${model.label || model.id}：${model.installed ? '已下载' : '未下载'}；${model.detail || ''}`).join('\n') : result.error || '读取模型状态失败';
  }
  $('refreshAlignmentModels').onclick = () => void models();
  $('prepareAlignmentModel').onclick = async () => {
    const modelId = $('alignmentModel').value;
    if (!modelId) { $('alignmentModelsStatus').textContent = '请先选择对齐模型'; return; }
    const result = await call('prepare_alignment_model', { modelId, modelPath: $('alignmentModelPath').value.trim() });
    $('alignmentModelsStatus').textContent = result.ok ? '正在下载，首次准备可能需要数 GB 空间…' : result.detail || result.error || '无法开始下载';
  };
  $('cancelAlignmentModel').onclick = async () => { await call('cancel_alignment_model'); };
  document.addEventListener('mswlauncherbackend', event => {
    const data = event.detail;
    if (data.type === 'localRuntimeReady') void inventory();
    if (data.type === 'alignmentModelProgress') $('alignmentModelsStatus').textContent = data.message || '';
    if (['alignmentModelPrepared', 'alignmentPrepareCancelled'].includes(data.type)) void models();
    if (data.code === 'alignment_prepare_failed') $('alignmentModelsStatus').textContent = data.detail || '下载失败';
  });
  let inspectRevision = 0;
  let inspectedPath = '';
  async function inspectInput() {
    const path = $('timestampInput').value.trim();
    if (path === inspectedPath) return;
    const revision = ++inspectRevision;
    if (!path) return;
    const result = await call('inspect_alignment_input', { path });
    if (revision !== inspectRevision) return;
    if (!result.ok) { $('timestampResult').textContent = result.error || '无法读取输入'; return; }
    inspectedPath = path;
    $('timestampTrack').replaceChildren(...result.tracks.map(track => new Option(track.label, track.id)));
    $('timestampResult').textContent = '';
  }
  $('timestampInput').addEventListener('change', () => void inspectInput());
  for (const [button, field, kind] of [['pickTimestampInput', 'timestampInput', 'subtitle'], ['pickTimestampMedia', 'timestampMedia', 'media']]) {
    $(button).onclick = async () => { const result = await call('choose_file', { kind }); if (result.ok) { $(field).value = result.path || ''; if (field === 'timestampInput') await inspectInput(); } };
  }
  $('runTimestampTool').onclick = async () => {
    const path = $('timestampInput').value.trim(), mediaPath = $('timestampMedia').value.trim();
    const audioText = $('timestampAudio').value, targetTrack = $('timestampTrack').value;
    if (!path || (targetTrack !== 'main' && (!mediaPath || audioText === ''))) {
      $('timestampResult').textContent = '请选择输入；副字幕／叠加字幕还需明确指定匹配音频和音轨。'; return;
    }
    $('runTimestampTool').disabled = true;
    $('timestampResult').textContent = '正在对齐，原工程保持不变…';
    try {
      const result = await call('run_timestamp_alignment', {
        projectPath: /\.(mosp|json)$/i.test(path) ? path : '', srtPath: /\.srt$/i.test(path) ? path : '',
        mediaPath, targetTrack, audioIndex: audioText === '' ? null : Number(audioText),
        modelId: $('timestampModel').value, alignmentMode: $('timestampMode').value,
      });
      $('timestampResult').textContent = result.ok ? `${result.projectPath}\n成功 ${result.report?.alignedSegments || 0} 段；跳过 ${result.report?.skippedSegments || 0} 段；失败 ${result.report?.failedSegments || 0} 段\n${(result.warnings || []).join('\n')}` : result.detail || result.error || '对齐失败';
    } catch (error) { $('timestampResult').textContent = error.message; }
    finally { $('runTimestampTool').disabled = false; }
  };
  $('cancelTimestampTool').onclick = () => void call('cancel_media_tool');
  document.querySelectorAll('[data-comparison-tool]').forEach(button => button.onclick = async () => {
    const result = await call('open_comparison_tool', { tool: button.dataset.comparisonTool });
    $('comparisonResult').textContent = result.ok ? '' : result.error || '打开失败';
  });
  localVisibility();
})();
