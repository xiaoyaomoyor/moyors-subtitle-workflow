// Subtitle assets are independent copies. Audio inventory retains its existing contract.
(function (global) {
  'use strict';
  const p = () => global.MSWProject;
  const copy = value => p().clone(value);
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const string = (value, max = 160) => typeof value === 'string' && [...value].length <= max;
  function validSubtitle(a) {
    if (!object(a) || a.kind !== 'subtitle' || !p().validId(a.id) || !p().validId(a.batch_id)
      || !p().validId(a.source_id) || !string(a.source_cue_id) || !a.source_cue_id
      || !(a.track_id === null || (string(a.track_id) && a.track_id))
      || !integer(a.created_at) || !integer(a.original_start) || !integer(a.start) || !integer(a.end)
      || a.end <= a.start || !string(a.text, 12000)) return false;
    if (a.items !== undefined && (!Array.isArray(a.items) || a.items.length > 12000 || a.items.some(i =>
      !object(i) || !integer(i.start) || !integer(i.end) || i.start < a.start || i.end > a.end || i.end <= i.start || !string(i.text, 12000)))) return false;
    if (a.color !== undefined && (!object(a.color) || !string(a.color.name) || !/^#[0-9a-f]{6}$/i.test(a.color.value || ''))) return false;
    return true;
  }
  function validate(ext) {
    const rows = ext.subtitle_assets ?? [], batches = ext.asset_batches ?? [];
    if (!Array.isArray(rows) || rows.length > 10000 || !rows.every(validSubtitle)
      || new Set(rows.map(a => a.id)).size !== rows.length) throw Error('字幕素材格式无效或重复');
    if (!Array.isArray(batches) || batches.length > 10000 || batches.some(b => !object(b) || !p().validId(b.id)
      || !['copy','asr','tts','imported','regenerated'].includes(b.kind) || !integer(b.created_at)
      || (b.result_id !== undefined && !p().validId(b.result_id)) || (b.parent_id !== undefined && !p().validId(b.parent_id)))
      || new Set(batches.map(b => b.id)).size !== batches.length) throw Error('素材批次格式无效或重复');
    const ids = new Set(batches.map(b => b.id));
    if (rows.some(a => !ids.has(a.batch_id))) throw Error('字幕素材缺少批次');
    for (const b of batches) if (b.bindings !== undefined && (!Array.isArray(b.bindings) || b.bindings.length > 10000
      || b.bindings.some(binding => !object(binding) || !string(binding.track_id) || !binding.track_id
        || ['main_segment_ids','extension_segment_ids'].some(k => !Array.isArray(binding[k]) || !binding[k].length
          || binding[k].length > 10000 || binding[k].some(id => !string(id) || !id))
        || ['start_offset_ms','end_offset_ms'].some(k => !Number.isSafeInteger(binding[k]) || Math.abs(binding[k]) > 1e12)))) throw Error('素材配对记录无效');
  }
  function batches(ext) {
    const map = new Map((ext.asset_batches || []).map(b => [b.id, copy(b)]));
    for (const a of ext.assets || []) if (!map.has(a.batch_id || a.job_id)) map.set(a.batch_id || a.job_id, {id:a.batch_id || a.job_id,
      kind:a.generation.provider === 'imported' ? 'imported' : 'tts', created_at:Math.round((a.created_at || 0) * 1000)});
    return [...map.values()];
  }
  function capture(project, selection, options = {}) {
    const tracks = project.multi_subtitle?.tracks || [], ext = p().ensure(project);
    const selected = [{track_id:null, segments:project.segments || [], ids:new Set(selection.mainIds || [])},
      ...tracks.filter(t => t.id === selection.trackId).map(t => ({track_id:t.id, segments:t.segments, ids:new Set(selection.extensionIds || [])}))];
    const rows = selected.flatMap(t => t.segments.filter(c => t.ids.has(c.id)).map(c => ({c,t})));
    if (!rows.length) throw Error('请先选择字幕');
    const origin = Math.min(...rows.map(r => r.c.start)), batchId = options.batchId || p().id('batch');
    const time = Date.now();
    const assets = rows.map(({c,t}) => {
      const a = {id:p().id('subtitle'), kind:'subtitle', batch_id:batchId, created_at:time,
        source_id:options.sourceId || ext.project_id, source_cue_id:c.id, track_id:t.track_id,
        original_start:c.start, start:c.start-origin, end:c.end-origin, text:c.text || ''};
      if (c.items) a.items = c.items.filter(i => i.start >= c.start && i.end <= c.end && i.end > i.start)
        .map(i => ({start:i.start-origin,end:i.end-origin,text:i.text || ''}));
      const color = c.color || t.segments[c.color_ref?.headIdx]?.color;
      if (color) a.color = {name:color.name || '', value:color.value || '#777777'};
      for (const key of ['style','split_mode']) if (c[key] !== undefined) a[key] = copy(c[key]);
      return a;
    });
    const main = new Set(assets.filter(a => a.track_id === null).map(a => a.source_cue_id));
    const secondary = new Set(assets.filter(a => a.track_id !== null).map(a => a.source_cue_id));
    const bindings = (project.multi_subtitle?.bindings || []).filter(b => b.track_id === selection.trackId
      && b.main_segment_ids.every(id => main.has(id)) && b.extension_segment_ids.every(id => secondary.has(id))).map(copy);
    return {assets, batch:{id:batchId, kind:options.kind || 'copy', created_at:time, bindings,
      ...(options.resultId ? {result_id:options.resultId} : {})}};
  }
  function add(ext, assets, batch) {
    const next = copy(ext);
    if (batch.result_id && (next.asset_batches || []).some(b => b.result_id === batch.result_id)) return null;
    if ((next.asset_batches || []).some(b => b.id === batch.id)) return null;
    next.asset_batches = [...batches(next), copy(batch)];
    next.subtitle_assets = [...(next.subtitle_assets || []), ...copy(assets)];
    validate(next); return next;
  }
  function insert(project, ids, anchor, targets = {}, normalize = c => c) {
    const selected = new Set(ids), assets = (project.msw?.subtitle_assets || []).filter(a => selected.has(a.id));
    if (!assets.length) throw Error('请选择字幕素材');
    if (new Set(assets.map(a => a.source_id)).size > 1) throw Error('不同来源的字幕请分批放入时间线');
    if (!integer(anchor)) throw Error('插入位置无效');
    const next = copy(project), origin = Math.min(...assets.map(a => a.original_start));
    const tracks = new Map((next.multi_subtitle?.tracks || []).map(t => [t.id,t.segments])); tracks.set(null,next.segments);
    const rows = assets.map(a => {
      const track = a.track_id === null ? null : targets[a.track_id] || a.track_id;
      const row = {id:a.id, asset:a, track, reason:''};
      if (!tracks.has(track)) { row.reason = '请选择目标副字幕轨'; return row; }
      const start = anchor + a.original_start-origin, shift = start-a.start;
      row.cue = normalize({id:p().id('cue'), start, end:start+a.end-a.start, text:a.text,
        ...(a.items ? {items:a.items.map(i => ({...i,start:i.start+shift,end:i.end+shift}))} : {}),
        ...(a.color ? {color:{...copy(a.color), start, end:start+a.end-a.start}} : {}),
        ...(a.style ? {style:copy(a.style)} : {}), ...(a.split_mode ? {split_mode:a.split_mode} : {})});
      return row;
    });
    const overlaps = (a,b) => a.start < b.end && b.start < a.end;
    for (const row of rows.filter(r => r.cue)) {
      if (tracks.get(row.track).some(c => overlaps(c,row.cue))) row.reason = '与现有字幕重叠';
      if (rows.some(r => r !== row && r.track === row.track && r.cue && overlaps(r.cue,row.cue))) row.reason = '所选字幕彼此重叠';
    }
    const accepted = rows.filter(r => r.cue && !r.reason);
    for (const [track,segs] of tracks) {
      const oldIds = segs.map(c => c.id);
      segs.push(...accepted.filter(r => r.track === track).map(r => r.cue)); segs.sort((a,b) => a.start-b.start || a.end-b.end);
      const indices = new Map(segs.map((c,i) => [c.id,i]));
      for (const c of segs) for (const field of ['color_ref','sticker_ref']) if (c[field]) c[field].headIdx = indices.get(oldIds[c[field].headIdx]);
    }
    for (const batch of project.msw?.asset_batches || []) for (const binding of batch.bindings || []) {
      const find = (id,track) => accepted.find(r => r.asset.batch_id === batch.id && r.asset.source_cue_id === id && r.asset.track_id === track);
      const main = binding.main_segment_ids.map(id => find(id,null)), secondary = binding.extension_segment_ids.map(id => find(id,binding.track_id));
      if (main.every(Boolean) && secondary.every(Boolean)) next.multi_subtitle.bindings.push({...copy(binding),id:p().id('binding'),
        track_id:secondary[0].track,main_segment_ids:main.map(r => r.cue.id),extension_segment_ids:secondary.map(r => r.cue.id)});
    }
    return {project:next, count:accepted.length, rows:rows.map(r => ({id:r.id,text:r.asset.text,reason:r.reason}))};
  }
  global.MSWAssets = Object.freeze({validate, validSubtitle, batches, capture, add, insert});
})(typeof window === 'undefined' ? globalThis : window);
