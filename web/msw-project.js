// MSW project namespace: preserve extensions through every editor entry point.
(function (global) {
  'use strict';
  const SCHEMA = 'msw.editor.v1';
  const validId = (value) => typeof value === 'string' && value.length >= 1 && value.length <= 128 && !/[^A-Za-z0-9_.:-]/.test(value);
  const validCueId = (value) => typeof value === 'string' && value.length >= 1 && value.length <= 160 && value === value.trim();
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  function validAsset(asset) {
    if (!asset || typeof asset !== 'object' || !/^audio-[0-9a-f]{32}$/.test(asset.id || '') || asset.kind !== 'audio') return false;
    if (typeof asset.path !== 'string' || !new RegExp(`^msw-[0-9a-f]{24}\\.assets/audio/${asset.id}\\.wav$`).test(asset.path)) return false;
    if (typeof asset.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(asset.sha256)) return false;
    for (const [key, low, high] of [['sample_rate', 8000, 192000], ['channels', 1, 8], ['sample_count', 1, 2 ** 32], ['byte_size', 44, 32 * 1024 * 1024]]) {
      if (!Number.isInteger(asset[key]) || asset[key] < low || asset[key] > high) return false;
    }
    const recipe = asset.generation, source = asset.source_ref;
    if (!recipe || !source || ['provider', 'model', 'voice', 'language_type', 'display_text', 'spoken_text']
      .some(key => typeof recipe[key] !== 'string' || [...recipe[key]].length > 2000)) return false;
    return validId(asset.job_id) && validId(source.key) && validCueId(source.id)
      && (source.track_id == null || validCueId(source.track_id)) && typeof source.text === 'string' && [...source.text].length <= 600
      && Number.isInteger(source.start) && Number.isInteger(source.end) && source.start >= 0 && source.start < source.end;
  }
  function normalize(value) {
    if (value == null) return null;
    if (typeof value !== 'object' || Array.isArray(value) || value.schema !== SCHEMA) {
      throw new Error('此工程的 MSW 扩展版本不受支持，请使用对应版本的编辑器打开');
    }
    if (!validId(value.project_id)) throw new Error('MSW 工程标识无效');
    if (value.source_project_id != null && !validId(value.source_project_id)) throw new Error('MSW 来源工程标识无效');
    const applied = value.applied_results ?? [];
    if (!Array.isArray(applied) || applied.length > 10000 || !applied.every(validId)) {
      throw new Error('MSW 结果记录格式无效');
    }
    const partial = value.translation_applications ?? {};
    if (typeof partial !== 'object' || partial === null || Array.isArray(partial)
      || Object.keys(partial).length > 10000 || Object.entries(partial).some(([key, ids]) =>
        !validId(key) || !Array.isArray(ids) || ids.length > 10000 || !ids.every(validCueId))) {
      throw new Error('MSW 翻译应用记录格式无效');
    }
    const targets = value.translation_target_tracks ?? {};
    if (typeof targets !== 'object' || targets === null || Array.isArray(targets)
      || Object.keys(targets).length > 10000 || Object.entries(targets).some(([key, id]) => !validId(key) || !validCueId(id))) {
      throw new Error('MSW 翻译目标记录格式无效');
    }
    const assets = value.assets ?? [];
    if (!Array.isArray(assets) || assets.length > 10000 || !assets.every(validAsset) || new Set(assets.map(a => a.id)).size !== assets.length) {
      throw new Error('MSW 音频素材格式无效或重复');
    }
    if (['audio_tracks', 'audio_clips', 'audio_settings'].some(key => key in value)) {
      if (!global.MSWAudio) throw new Error('音频贴片模块未加载');
      global.MSWAudio.validate(value);
    }
    return clone(value);
  }
  function id(prefix = 'msw') {
    return `${prefix}-${global.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
  }
  function ensure(project, fallbackId) {
    if (!project.msw) {
      project.msw = { schema: SCHEMA, project_id: validId(fallbackId) ? fallbackId : id('project'), applied_results: [] };
    }
    return project.msw;
  }
  global.MSWProject = Object.freeze({ SCHEMA, validId, validAsset, clone, normalize, ensure, id });
  global.MSWE?.register('msw-project', () => global.MSWProject);
})(window);
