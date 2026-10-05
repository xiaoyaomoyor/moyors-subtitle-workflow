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
      this.entries = cues.map((cue, index) => ({ cue, index })).filter(row => validRange(row.cue) && predicate(row.cue))
        .sort((a, b) => a.cue.start - b.cue.start || a.index - b.index);
      this.maxEnd = [];
      const build = (node, lo, hi) => {
        if (lo >= hi) return -Infinity;
        if (hi - lo === 1) return this.maxEnd[node] = this.entries[lo].cue.end;
        const mid = (lo + hi) >> 1;
        return this.maxEnd[node] = Math.max(build(node * 2, lo, mid), build(node * 2 + 1, mid, hi));
      };
      build(1, 0, this.entries.length);
    }
    range(start, end, { includeDisabled = true } = {}) {
      const found = [];
      const visit = (node, lo, hi) => {
        if (lo >= hi || this.maxEnd[node] <= start || this.entries[lo].cue.start >= end) return;
        if (hi - lo === 1) { if (includeDisabled || !this.entries[lo].cue.disabled) found.push(this.entries[lo].index); return; }
        const mid = (lo + hi) >> 1;
        visit(node * 2, lo, mid); visit(node * 2 + 1, mid, hi);
      };
      if (Number.isFinite(start) && end > start) visit(1, 0, this.entries.length);
      return found;
    }
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
  function sortTrack(cues) {
    const old = [...cues];
    cues.sort((a, b) => a.start - b.start);
    const indexes = new Map(cues.map((cue, index) => [cue, index]));
    for (const cue of cues) for (const field of ['color_ref', 'sticker_ref']) {
      if (cue[field] && Number.isInteger(cue[field].headIdx)) cue[field].headIdx = indexes.get(old[cue[field].headIdx]);
    }
  }
  const api = Object.freeze({ SCHEMA, LAYOUT_SCHEMA, LEGACY_SCHEMA, key, enabled, validRange, intersects,
    migrate, validate, tracks, records, visible, resolve, IntervalIndex, pack, applyRanges, sortTrack, materializeReferences });
  global.MSWSubtitleLayers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
