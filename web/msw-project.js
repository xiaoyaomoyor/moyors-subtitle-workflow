// MSW project namespace: preserve extensions through every editor entry point.
(function (global) {
  'use strict';
  const SCHEMA = 'msw.editor.v1';
  const validId = (value) => typeof value === 'string' && value.length >= 1 && value.length <= 128 && !/[^A-Za-z0-9_.:-]/.test(value);
  const validCueId = (value) => typeof value === 'string' && value.length >= 1 && value.length <= 160 && value === value.trim();
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  function normalize(value) {
    if (value == null) return null;
    if (typeof value !== 'object' || Array.isArray(value) || value.schema !== SCHEMA) {
      throw new Error('此工程的 MSW 扩展版本不受支持，请使用对应版本的编辑器打开');
    }
    if (!validId(value.project_id)) throw new Error('MSW 工程标识无效');
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
  global.MSWProject = Object.freeze({ SCHEMA, validId, clone, normalize, ensure, id });
  global.MSWE?.register('msw-project', () => global.MSWProject);
})(window);
