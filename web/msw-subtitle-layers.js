// Unified subtitle identities and derived layout. No DOM, media or persistence.
(function (global) {
  'use strict';
  const SCHEMA = 'msw.project.v2';
  const LAYOUT_SCHEMA = 'msw.subtitle_layers.v1';
  const LEGACY_SCHEMA = 'moy.asr.project.v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const key = ref => JSON.stringify([ref.role, ref.track_id || '', ref.cue_id]);
  const enabled = project => project?.schema === SCHEMA;
  const validRange = cue => Number.isSafeInteger(cue?.start) && Number.isSafeInteger(cue?.end)
    && cue.start >= 0 && cue.end > cue.start;
  const intersects = (a, b) => a.start < b.end && b.start < a.end;
  function ensureIds(cues, prefix) {
    const used = new Set();
    for (const cue of cues) {
      if (!cue || typeof cue !== 'object') throw Error('Invalid subtitle');
      if (cue.id) {
        if (used.has(cue.id)) throw Error('Duplicate subtitle ID: ' + cue.id);
        used.add(cue.id);
      }
    }
    cues.forEach((cue, index) => {
      if (cue.id) return;
      let id = `${prefix}-${String(index + 1).padStart(3, '0')}`, suffix = 2;
      while (used.has(id)) id = `${prefix}-${String(index + 1).padStart(3, '0')}-${suffix++}`;
      cue.id = id; used.add(id);
    });
  }
  function materializeReferences(cues) {
    const snapshots = cues.map(cue => {
      const result = {};
      for (const type of ['color', 'sticker']) {
        const ref = cue[type + '_ref'];
        const value = cue[type] || (ref && cues[ref.headIdx]?.[type]);
        if (ref && !value) throw Error('Dangling ' + type + ' reference');
        if (value) result[type] = { ...clone(value), start: cue.start, end: cue.end };
      }
      return result;
    });
    cues.forEach((cue, i) => {
      for (const type of ['color', 'sticker']) {
        if (snapshots[i][type]) cue[type] = snapshots[i][type];
        delete cue[type + '_ref'];
      }
    });
  }
  function migrate(input) {
    if (!input || !Array.isArray(input.segments)) throw Error('Invalid subtitle project');
    if (Object.hasOwn(input, 'schema') && ![SCHEMA, LEGACY_SCHEMA].includes(input.schema)) throw Error('Unsupported project schema');
    const project = clone(input);
    if (enabled(project)) { validate(project); return project; }
    const main = project.segments, overlay = project.overlay_track || {};
    const extra = overlay.segments || [];
    ensureIds(main, 'main'); ensureIds(extra, 'overlay');
    materializeReferences(main); materializeReferences(extra);
    const used = new Set(main.map(cue => cue.id)), remap = new Map();
    extra.forEach((cue, i) => {
      const old = cue.id;
      let next = old, suffix = 2;
      const base = `legacy-overlay-${i + 1}`;
      if (used.has(next)) next = base;
      while (used.has(next)) next = `${base}-${suffix++}`;
      used.add(next); remap.set(old, next); cue.id = next;
    });
    // Only identity-bearing references are rewritten. Text, recipe snapshots
    // and opaque result revisions must never undergo arbitrary replacement.
    function rewrite(value) {
      if (!value || typeof value !== 'object') return;
      if (value.track_kind === 'overlay' || value.role === 'overlay') {
        for (const field of ['id', 'cue_id', 'segment_id']) if (remap.has(value[field])) value[field] = remap.get(value[field]);
        if (value.track_kind === 'overlay') delete value.track_kind;
        if (value.role === 'overlay') value.role = 'main';
      }
      for (const child of Object.values(value)) rewrite(child);
    }
    rewrite(project.msw);
    main.push(...extra);
    main.sort((a, b) => a.start - b.start);
    for (const track of project.multi_subtitle?.tracks || []) {
      ensureIds(track.segments || [], `${track.id}-segment`);
      materializeReferences(track.segments || []);
      track.segments?.sort((a, b) => a.start - b.start);
    }
    project.subtitle_layers = {
      schema: LAYOUT_SCHEMA,
      allow_overlap: input.overlay_track ? overlay.enabled === true : true,
      legacy_overlay: { visible: overlay.enabled === true, cue_ids: extra.map(cue => cue.id) },
    };
    delete project.overlay_track;
    const preview=input.preview;
    if ((main.length || extra.length) && preview && (preview.ass_library_exports || preview.burn_subtitles || ['x','y','width','height'].some(k=>Object.hasOwn(preview.subtitle||{},k)))) {
      project.subtitle_layers.presentation={mode:'manual',gap:12};
    }
    project.schema = SCHEMA;
    validate(project);
    return project;
  }
  function validate(project) {
    const metadata = project?.subtitle_layers, legacy = metadata?.legacy_overlay;
    if (!enabled(project) || metadata?.schema !== LAYOUT_SCHEMA || typeof metadata.allow_overlap !== 'boolean'
        || !legacy || typeof legacy.visible !== 'boolean' || !Array.isArray(legacy.cue_ids)) throw Error('Invalid subtitle layer metadata');
    if (project.overlay_track && (!Array.isArray(project.overlay_track.segments) || project.overlay_track.segments.length)) throw Error('v2 subtitles must use main or extension roles');
    for (const track of tracks(project)) {
      const used = new Set();
      for (const cue of track.segments) {
        if (!validRange(cue) || typeof cue.id !== 'string' || !cue.id.trim() || cue.id.length > 160 || used.has(cue.id)) throw Error('Invalid subtitle identity or time range');
        used.add(cue.id);
      }
    }
    const presentation=metadata.presentation;
    if(presentation!==undefined&&(!presentation||!['auto','manual'].includes(presentation.mode)||!Number.isInteger(presentation.gap)||presentation.gap<0||presentation.gap>120||(presentation.order!==undefined&&!['earlier-bottom','earlier-top'].includes(presentation.order))))throw Error('Invalid subtitle presentation');
    const ids = new Set(project.segments.map(cue => cue.id));
    if (new Set(legacy.cue_ids).size !== legacy.cue_ids.length || legacy.cue_ids.some(id => !ids.has(id))) throw Error('Invalid legacy visibility references');
    return true;
  }
  function tracks(project) {
    return [{ role: 'main', track_id: null, segments: project.segments || [] },
      ...(project.multi_subtitle?.tracks || []).map(track => ({ role: 'extension', track_id: track.id, segments: track.segments || [] }))];
  }
  function visible(project, cue, role = 'main') {
    const legacy = project.subtitle_layers?.legacy_overlay;
    return !(role === 'main' && legacy?.visible === false && legacy.cue_ids?.includes(cue.id));
  }
  function records(project, { includeHidden = false, includeDisabled = true } = {}) {
    return tracks(project).flatMap(track => track.segments.flatMap((cue, index) =>
      (!includeHidden && !visible(project, cue, track.role)) || (!includeDisabled && cue.disabled) ? []
        : [{ role: track.role, track_id: track.track_id, cue_id: cue.id, cue, index }]));
  }
  function resolve(project, ref) {
    const track = tracks(project).find(t => t.role === ref.role && (t.track_id || null) === (ref.track_id || null));
    const index = track?.segments.findIndex(cue => cue.id === ref.cue_id) ?? -1;
    return index < 0 ? null : { ...track, cue_id: ref.cue_id, cue: track.segments[index], index };
  }
  class IntervalIndex {
    constructor(cues, predicate = () => true) {
      this.cues = cues; this.changed = new Set();
      this.entries = cues.map((cue, index) => ({ cue, index, start: cue.start, end: cue.end })).filter(row => validRange(row.cue) && predicate(row.cue))
        .sort((a, b) => a.start - b.start || a.index - b.index);
      this.maxEnd = [];
      const build = (node, lo, hi) => {
        if (lo >= hi) return -Infinity;
        if (hi - lo === 1) return this.maxEnd[node] = this.entries[lo].end;
        const mid = (lo + hi) >> 1;
        return this.maxEnd[node] = Math.max(build(node * 2, lo, mid), build(node * 2 + 1, mid, hi));
      };
      build(1, 0, this.entries.length);
    }
    range(start, end, { includeDisabled = true } = {}) {
      const found = [];
      const visit = (node, lo, hi) => {
        if (lo >= hi || this.maxEnd[node] <= start || this.entries[lo].start >= end) return;
        if (hi - lo === 1) { if (!this.changed.has(this.entries[lo].index) && (includeDisabled || !this.entries[lo].cue.disabled)) found.push(this.entries[lo].index); return; }
        const mid = (lo + hi) >> 1;
        visit(node * 2, lo, mid); visit(node * 2 + 1, mid, hi);
      };
      if (Number.isFinite(start) && end > start) visit(1, 0, this.entries.length);
      for (const index of this.changed) {
        const cue=this.cues[index];
        if (validRange(cue) && cue.start < end && cue.end > start && (includeDisabled || !cue.disabled)) found.push(index);
      }
      return found.sort((a,b)=>this.cues[a].start-this.cues[b].start||a-b);
    }
    update(indices) { for (const index of indices) this.changed.add(index); }
    at(time, options = {}) { return this.range(time, Math.floor(time) + 1, options); }
  }
  function pack(cues, previous = new Map(), predicate = () => true) {
    const index = new IntervalIndex(cues, predicate), ends = [], lanes = new Map();
    for (const { cue } of index.entries) {
      let lane = previous.get(cue.id);
      if (!Number.isInteger(lane) || lane < 0 || lane > ends.length || (ends[lane] ?? -Infinity) > cue.start) {
        lane = ends.findIndex(end => end <= cue.start);
        if (lane < 0) lane = ends.length;
      }
      ends[lane] = cue.end; lanes.set(cue.id, lane);
    }
    return { index, lanes, count: Math.max(1, ends.length) };
  }
  function updatePack(layout, cues, indices) {
    const changed=[...new Set(indices)].filter(index=>validRange(cues[index]));
    layout.index.update(changed);
    for(const index of changed) {
      const cue=cues[index], blocked=new Set(layout.index.range(cue.start,cue.end)
        .filter(other=>other!==index).map(other=>layout.lanes.get(cues[other].id)));
      let lane=layout.lanes.get(cue.id)||0;
      if(blocked.has(lane)) {lane=0;while(blocked.has(lane))lane++;}
      layout.lanes.set(cue.id,lane);layout.count=Math.max(layout.count,lane+1);
    }
    return layout;
  }
  function applyRanges(project, changes, { allowOverlap = project.subtitle_layers?.allow_overlap !== false, dryRun = false } = {}) {
    const pending = changes.map(change => ({ ...change, target: resolve(project, change.ref) }));
    if (pending.some(change => !change.target || !validRange(change))) return { ok: false, reason: 'invalid-target' };
    if (new Set(pending.map(change => key(change.ref))).size !== pending.length) return { ok: false, reason: 'duplicate-target' };
    if (!allowOverlap) {
      const next = new Map(pending.map(change => [key(change.ref), change]));
      for (const change of pending) for (const row of records(project)) {
        if (row.role !== change.ref.role || row.track_id !== (change.ref.track_id || null) || row.cue_id === change.ref.cue_id) continue;
        const other = next.get(key(row)) || row.cue;
        if (intersects(change, other) && !intersects(change.target.cue, row.cue)) return { ok: false, reason: 'overlap-disabled' };
      }
    }
    if (dryRun) return { ok: true };
    for (const change of pending) {
      const cue = change.target.cue, delta = change.start - cue.start;
      const moved = change.end - cue.end === delta;
      if (moved) for (const item of cue.items || []) { item.start += delta; item.end += delta; }
      else if (cue.items?.some(item => item.start < change.start || item.end > change.end)) cue.items = [];
      cue.start = change.start; cue.end = change.end; cue._dirty = true;
      delete cue.start_frame; delete cue.end_frame;
    }
    return { ok: true };
  }
  function legacyExport(source) {
    const project=clone(source);
    if(!enabled(project))return project;
    validate(project);
    for (const track of tracks(project)) materializeReferences(track.segments);
    const legacy=project.subtitle_layers.legacy_overlay, oldIds=new Set(legacy.cue_ids);
    const overlays=project.segments.filter(c=>oldIds.has(c.id));
    project.segments=project.segments.filter(c=>!oldIds.has(c.id));
    for(const track of [{role:'main',segments:project.segments},{role:'overlay',segments:overlays},...(project.multi_subtitle?.tracks||[])]) {
      if(pack(track.segments).count>1) throw Error('旧版工程不能表达当前角色中的多层重叠，请保存新版工程，或导出 ASS／合并显示 SRT');
    }
    if(overlays.length && ((project.multi_subtitle?.bindings||[]).some(b=>b.main_segment_ids.some(id=>oldIds.has(id))) || project.msw?.processing_results?.length)) {
      throw Error('旧叠加组已参与绑定或处理记录，无法无损回到旧版；请保存新版工程');
    }
    function restore(value) {
      if(!value||typeof value!=='object')return;
      if(value.source_ref && value.source_ref.track_id==null && oldIds.has(value.source_ref.id)) value.source_ref.track_kind='overlay';
      for(const child of Object.values(value))restore(child);
    }
    restore(project.msw);
    if(overlays.length) project.overlay_track={enabled:legacy.visible,segments:overlays};
    delete project.subtitle_layers;project.schema=LEGACY_SCHEMA;
    return project;
  }
  function sortTrack(cues) {
    const old = [...cues];
    cues.sort((a, b) => a.start - b.start);
    const indexes = new Map(cues.map((cue, index) => [cue, index]));
    for (const cue of cues) for (const field of ['color_ref', 'sticker_ref']) {
      if (cue[field] && Number.isInteger(cue[field].headIdx)) cue[field].headIdx = indexes.get(old[cue[field].headIdx]);
    }
  }

  // Build an atomic merge without mutating the project. Markers are semantic
  // values, not group-head identities; provenance and audio remain untouched.
  function planMerge(project, ref, ids, { mode = 'union', joinText = cues => cues.map(c => c.text || '').join(' '), makeId } = {}) {
    const allTracks = tracks(project);
    if (project.overlay_track) allTracks.push({ role: 'overlay', track_id: null, segments: project.overlay_track.segments || [] });
    const source = allTracks.find(t => t.role === ref.role && t.track_id === (ref.track_id || null));
    const wanted = new Set(ids);
    const chosen = source?.segments.filter(c => wanted.has(c.id)) || [];
    if (chosen.length < 2 || chosen.length !== wanted.size) throw Error('请选择至少两个同轨道字幕块');
    const bindings = project.multi_subtitle?.bindings || [];
    const matches = (b, t, set) => t.role === 'main' ? b.main_segment_ids?.some(id => set.has(id))
      : t.role === 'extension' && b.track_id === t.track_id && b.extension_segment_ids?.some(id => set.has(id));
    const related = bindings.filter(b => matches(b, source, wanted));
    if (related.some(b => b.main_segment_ids?.length !== 1 || b.extension_segment_ids?.length !== 1)) throw Error('绑定关系异常，请先检查主副字幕绑定');
    const trackIds = new Set(related.map(b => b.track_id));
    if (trackIds.size > 1) throw Error('所选字幕绑定到不同副轨，请分轨合并');
    const groups = [{ track: source, ids: wanted }];
    if (related.length) {
      const partner = allTracks.find(t => source.role === 'main'
        ? t.role === 'extension' && t.track_id === related[0].track_id : t.role === 'main');
      const partnerIds = new Set(related.flatMap(b => source.role === 'main' ? b.extension_segment_ids : b.main_segment_ids));
      if (!partner || [...partnerIds].some(id => !partner.segments.some(c => c.id === id))) throw Error('绑定字幕缺失，请先检查主副字幕绑定');
      if (bindings.some(b => matches(b, partner, partnerIds) && !related.includes(b))) throw Error('绑定关系异常，请先检查主副字幕绑定');
      groups.push({ track: partner, ids: partnerIds });
    }
    const canonical = value => {
      if (Array.isArray(value)) return value.map(canonical);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.keys(value).sort().filter(k => !['start','end','headIdx'].includes(k)).map(k => [k, canonical(value[k])]));
    };
    const marker = (cue, track, field) => {
      const reference = cue[field + '_ref'];
      const value = cue[field] || (reference && track.segments[reference.headIdx]?.[field]);
      if (reference && !value) throw Error('字幕分组引用异常，请先检查颜色或表情包');
      return value || null;
    };
    const used = new Set(allTracks.flatMap(t => t.segments.map(c => c.id)));
    const freshId = base => {
      let id = makeId ? makeId() : `${base.slice(0, 135)}-merged`, n = 2;
      while (used.has(id)) id = `${base.slice(0, 130)}-merged-${n++}`;
      used.add(id); return id;
    };
    const conflicts = new Set();
    const changes = groups.map(({ track, ids: members }) => {
      const cues = track.segments.filter(c => members.has(c.id)).sort((a,b) => a.start - b.start || track.segments.indexOf(a) - track.segments.indexOf(b));
      if (cues.length === 1) return { ...track, ids: members, merged: cues[0], segments: track.segments, changed: false };
      if (cues.some(c => !validRange(c))) throw Error('字幕时间范围无效，无法合并');
      const start = Math.min(...cues.map(c => c.start)), end = Math.max(...cues.map(c => c.end));
      if (!enabled(project)) {
        const indexes = cues.map(c => track.segments.indexOf(c)).sort((a,b) => a-b);
        if (indexes.some((n,i) => i && n !== indexes[i-1]+1)) throw Error('选中的字幕必须连续');
      }
      if ((!enabled(project) || !project.subtitle_layers.allow_overlap) && track.segments.some(c => !members.has(c.id)
          && intersects(c, {start,end}) && !cues.some(sourceCue => intersects(c,sourceCue)))) {
        throw Error('合并范围会新增重叠，请先启用“允许字幕重叠”');
      }
      const merged = { ...clone(cues[0]), id: freshId(cues[0].id), start, end, text: joinText(cues, track),
        items: cues.flatMap(c => (Array.isArray(c.items) ? c.items : []).filter(item => validRange(item)
          && item.start >= c.start && item.end <= c.end).map(clone)).sort((a,b) => a.start-b.start || a.end-b.end),
        disabled: mode === 'common' ? cues.every(c => c.disabled === true) : cues.some(c => c.disabled === true), _dirty: true };
      delete merged.start_frame; delete merged.end_frame;
      if (merged.speaker == null || !cues.every(c => c.speaker === merged.speaker)) delete merged.speaker;
      for (const field of ['color','sticker']) {
        delete merged[field]; delete merged[field + '_ref'];
        const values = cues.map(c => marker(c,track,field));
        const first = values.find(Boolean);
        // Palette names are the color identity; old projects can retain a
        // previous palette's hex value for the same named marker.
        const identity = value => JSON.stringify(field === 'color' && value?.name ? {name:value.name} : canonical(value));
        const same = first && values.every(v => v && identity(v) === identity(first));
        if (first && (mode !== 'common' || same)) merged[field] = { ...clone(first), start, end };
        if (mode !== 'common' && new Set(values.filter(Boolean).map(identity)).size > 1) conflicts.add(field);
      }
      const segments = track.segments.filter(c => !members.has(c.id)).map(clone);
      segments.push(merged); segments.sort((a,b) => a.start-b.start);
      const positions = new Map(segments.map((c,i) => [c.id,i]));
      for (const cue of segments) if (cue !== merged) for (const field of ['color','sticker']) {
        const reference = cue[field + '_ref'];
        if (!reference) continue;
        const head = track.segments[reference.headIdx];
        if (!head?.[field]) throw Error('字幕分组引用异常，请先检查颜色或表情包');
        if (members.has(head.id)) {
          cue[field] = { ...clone(head[field]), start: cue.start, end: cue.end };
          delete cue[field + '_ref'];
        } else reference.headIdx = positions.get(head.id);
      }
      return { ...track, ids: members, merged, segments, changed: true };
    });
    const nextBindings = bindings.filter(b => !related.includes(b)).map(clone);
    if (related.length) {
      const main = changes.find(t => t.role === 'main').merged;
      const extension = changes.find(t => t.role === 'extension');
      nextBindings.push({ id: `binding-${main.id}-${extension.merged.id}`.slice(0,160), track_id: extension.track_id,
        main_segment_ids: [main.id], extension_segment_ids: [extension.merged.id],
        start_offset_ms: extension.merged.start-main.start, end_offset_ms: extension.merged.end-main.end });
    }
    return { changes, bindings: nextBindings, conflicts: [...conflicts], linked: related.length > 0 };
  }

  const api = Object.freeze({ SCHEMA, LAYOUT_SCHEMA, LEGACY_SCHEMA, key, enabled, validRange, intersects,
    migrate, validate, legacyExport, tracks, records, visible, resolve, planMerge, IntervalIndex, pack, updatePack, applyRanges, sortTrack, materializeReferences });
  global.MSWSubtitleLayers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
