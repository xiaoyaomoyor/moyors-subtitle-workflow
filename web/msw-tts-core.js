// Immutable subtitle selection for per-cue speech synthesis.
(function (global) {
  'use strict';
  function scope(project, selection, side = null) {
    const track = (project.multi_subtitle?.tracks || []).find(t => t.id === selection.trackId)
      || project.multi_subtitle?.tracks?.[0] || null;
    const mains = project.segments || [], secondary = track?.segments || [];
    const mainById = new Map(mains.map(cue => [cue.id, cue]));
    const extById = new Map(secondary.map(cue => [cue.id, cue]));
    const links = (project.multi_subtitle?.bindings || []).filter(b => b.track_id === track?.id
      && b.main_segment_ids?.length === 1 && b.extension_segment_ids?.length === 1
      && mainById.has(b.main_segment_ids[0]) && extById.has(b.extension_segment_ids[0]));
    const byMain = new Map(links.map(b => [b.main_segment_ids[0], b]));
    const byExt = new Map(links.map(b => [b.extension_segment_ids[0], b]));
    const selectedMain = new Set(selection.mainIds || []), selectedExt = new Set(selection.extensionIds || []);
    const hasSelection = Boolean(selection.hasSelection);
    const linked = links.filter(b => selectedMain.has(b.main_segment_ids[0]) || selectedExt.has(b.extension_segment_ids[0]));
    const needsChoice = hasSelection ? linked.length > 0 : mains.length > 0 && secondary.length > 0;
    const rows = new Map();
    const add = (cue, trackId) => { if (cue && typeof cue.text === 'string' && cue.text.trim()) rows.set(JSON.stringify([trackId, cue.id]), { cue, trackId }); };
    if (!hasSelection) {
      const chosen = side || (needsChoice ? null : (mains.length ? 'main' : 'secondary'));
      if (chosen === 'main') mains.forEach(cue => add(cue, null));
      if (chosen === 'secondary') secondary.forEach(cue => add(cue, track?.id));
    } else {
      selectedMain.forEach(id => { if (!byMain.has(id)) add(mainById.get(id), null); });
      selectedExt.forEach(id => { if (!byExt.has(id)) add(extById.get(id), track?.id); });
      linked.forEach(b => {
        if (side === 'main') add(mainById.get(b.main_segment_ids[0]), null);
        if (side === 'secondary') add(extById.get(b.extension_segment_ids[0]), track?.id);
      });
    }
    const sources = [...rows.values()].sort((a, b) => a.cue.start - b.cue.start || a.cue.end - b.cue.end);
    return { sources, needsChoice, all: !hasSelection, linked: linked.length,
      tooLong: sources.filter(row => [...row.cue.text].length > 600).length,
      signature: JSON.stringify([hasSelection, [...selectedMain].sort(), [...selectedExt].sort(), track?.id, linked.map(b => b.id)]) };
  }
  function snapshot(project, selection, side) {
    const selected = scope(project, selection, side);
    if (selected.needsChoice && !['main', 'secondary'].includes(side)) throw new Error('请先选择主字幕或副字幕');
    if (!selected.sources.length) throw new Error('没有可合成的字幕');
    if (selected.tooLong) throw new Error('存在超过 600 字符的字幕，请先拆分');
    return { project_id: project.msw.project_id, entries: selected.sources.map(({cue, trackId}) => ({
      key: global.MSWProject.id('entry'), id: cue.id, track_id: trackId, text: cue.text, start: cue.start, end: cue.end,
    })) };
  }
  function textSnapshot(project, text, start = 0) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('请输入要合成的配音草稿');
    if ([...text].length > 600) throw new Error('配音草稿超过 600 字符，请分段合成');
    if (!Number.isSafeInteger(start) || start < 0) throw new Error('配音起始位置无效');
    const id = global.MSWProject.id('text');
    // end is provisional; AssetStore replaces it with the actual audio duration.
    return {project_id: project.msw.project_id, entries: [{key: global.MSWProject.id('entry'), id,
      kind: 'editor_text', track_id: null, text, start, end: start + 1}]};
  }
  global.MSWTts = Object.freeze({ scope, snapshot, textSnapshot });
  global.MSWE?.register('msw-tts-core', () => global.MSWTts);
})(window);
