// Fixed-track data and editing primitives shared by production workflows.
(function (global) {
  'use strict';
  const layers = typeof module !== 'undefined' && module.exports
    ? require('./msw-subtitle-layers.js') : global.MSWSubtitleLayers;
  const SCHEMA = 'msw.project.v3';
  const TRACK_SCHEMA = 'msw.subtitle_tracks.v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const key = ref => JSON.stringify([ref.role, ref.track_id, ref.cue_id]);
  const stable = value => typeof value === 'string' && !!value.trim() && value.length <= 160;
  const fail = message => { throw Error('固定字幕轨道：' + message); };
  const refOf = row => ({ role: row.role, track_id: row.track_id, cue_id: row.cue_id });
  const positionValid = value => value && Object.keys(value).length === 2
    && ['x', 'y'].every(k => typeof value[k] === 'number' && Number.isFinite(value[k]) && value[k] >= 0 && value[k] <= 1);
  const snapshotValid = value => value?.schema === 'msw.subtitle-style.v1'
    && (value.annotation===undefined || value.annotation?.annotation===undefined && snapshotValid(value.annotation))
    && ['main', 'secondary'].every(k => value[k] && typeof value[k] === 'object' && !Array.isArray(value[k])
      && (value[k].wrapMode === undefined || ['auto', 'characters'].includes(value[k].wrapMode))
      && (value[k].charsPerLine === undefined || Number.isInteger(value[k].charsPerLine) && value[k].charsPerLine >= 1 && value[k].charsPerLine <= 200))
    && (value.pairLayout === undefined || value.pairLayout && ['main-above', 'secondary-above'].includes(value.pairLayout.order)
      && Number.isInteger(value.pairLayout.gap) && value.pairLayout.gap >= -240 && value.pairLayout.gap <= 240);
  const styleValid = style => style && ['inherit', 'snapshot'].includes(style.mode)
    && Object.keys(style).every(k => ['mode', 'value', 'selection', 'custom'].includes(k))
    && (style.mode === 'inherit' ? style.value === undefined : snapshotValid(style.value))
    && (style.custom === undefined || snapshotValid(style.custom))
    && (style.selection === undefined || stable(style.selection));

  function sourceRecords(project) {
    if (!project || !Array.isArray(project.segments)) fail('segments 必须是数组');
    if (project.multi_subtitle != null && (typeof project.multi_subtitle !== 'object' || Array.isArray(project.multi_subtitle))) fail('副字幕数据必须是对象');
    const tracks = project.multi_subtitle?.tracks ?? [];
    if (!Array.isArray(tracks)) fail('副字幕轨道必须是数组');
    const ids = new Set();
    for (const track of tracks) {
      if (!stable(track?.id) || ids.has(track.id) || !Array.isArray(track.segments)) fail('副字幕轨道 ID 重复或内容无效');
      ids.add(track.id);
    }
    const rows = [];
    for (const track of [{ role: 'main', track_id: null, segments: project.segments },
      ...tracks.map(t => ({ role: 'extension', track_id: t.id, segments: t.segments }))]) {
      const seen = new Set();
      track.segments.forEach((cue, index) => {
        if (!stable(cue?.id) || seen.has(cue.id) || !Number.isSafeInteger(cue.start)
          || !Number.isSafeInteger(cue.end) || cue.start < 0 || cue.end <= cue.start) fail('字幕 ID 重复或时间范围无效');
        if (cue.subtitle_position !== undefined && !positionValid(cue.subtitle_position)) fail('字幕位置必须是画面内的 x、y 比例');
        seen.add(cue.id);
        rows.push({ role: track.role, track_id: track.track_id, cue_id: cue.id, cue, index });
      });
    }
    return rows;
  }

  function bindingGroups(project, rows) {
    const byKey = new Map(rows.map(row => [key(row), row]));
    const partner = new Map(), usedIds = new Set();
    const bindings = project.multi_subtitle?.bindings ?? [];
    if (!Array.isArray(bindings)) fail('绑定必须是数组');
    for (const binding of bindings) {
      if (!binding || typeof binding !== 'object') fail('绑定内容无效');
      if (binding.id !== undefined) {
        if (!stable(binding.id) || usedIds.has(binding.id)) fail('绑定 ID 无效或重复');
        usedIds.add(binding.id);
      }
      const tracks = project.multi_subtitle.tracks;
      const trackId = binding.track_id ?? (tracks.length === 1 ? tracks[0].id : null);
      const main = binding.main_segment_ids ?? [binding.main_segment_id];
      const ext = binding.extension_segment_ids ?? [binding.extension_segment_id];
      if (!Array.isArray(main) || main.length !== 1 || !Array.isArray(ext) || ext.length !== 1) fail('绑定必须明确对应一条主字幕和一条副字幕');
      const a = key({ role: 'main', track_id: null, cue_id: main[0] });
      const b = key({ role: 'extension', track_id: trackId, cue_id: ext[0] });
      if (!byKey.has(a) || !byKey.has(b) || partner.has(a) || partner.has(b)) fail('绑定引用失效或重复；未修改工程');
      for (const [field, edge] of [['start_offset_ms', 'start'], ['end_offset_ms', 'end']]) {
        if (binding[field] !== undefined && binding[field] !== null
          && (!Number.isSafeInteger(binding[field]) || binding[field] !== byKey.get(b).cue[edge] - byKey.get(a).cue[edge])) fail('绑定时间偏移与字幕不一致');
      }
      partner.set(a, b); partner.set(b, a);
    }
    const groups = [], visited = new Set();
    for (const row of rows) {
      const id = key(row);
      if (visited.has(id)) continue;
      const group = [row]; visited.add(id);
      if (partner.has(id)) { group.push(byKey.get(partner.get(id))); visited.add(partner.get(id)); }
      groups.push(group);
    }
    return groups;
  }

  function validate(project) {
    if (project?.schema !== SCHEMA) fail('不支持的工程版本');
    // Reuse the presentation/legacy visibility contract, without changing it.
    layers.validate({ ...project, schema: layers.SCHEMA });
    const rows = sourceRecords(project), groups = bindingGroups(project, rows);
    const metadata = project.subtitle_tracks;
    if (metadata?.schema !== TRACK_SCHEMA || !['legacy', 'fixed'].includes(metadata.presentation)
      || !Array.isArray(metadata.tracks) || !metadata.tracks.length || !Array.isArray(metadata.assignments)) fail('轨道元数据无效');
    if (metadata.legacy_overlay_settings !== undefined && (!metadata.legacy_overlay_settings
      || typeof metadata.legacy_overlay_settings !== 'object' || Array.isArray(metadata.legacy_overlay_settings)
      || Object.hasOwn(metadata.legacy_overlay_settings, 'segments'))) fail('旧叠加设置不能包含第二份字幕正文');
    const tracks = new Map();
    for (const track of metadata.tracks) {
      if (!stable(track?.id) || tracks.has(track.id) || !stable(track.name)
        || !['dialogue', 'annotation'].includes(track.kind)
        || !['main', 'legacy-overlay'].includes(track.origin)
        || ['enabled', 'locked', 'collapsed'].some(k => typeof track[k] !== 'boolean')
        || (track.show_secondary !== undefined && typeof track.show_secondary !== 'boolean')
        || !styleValid(track.style)
        || (track.position !== undefined && !positionValid(track.position))) fail('轨道 ID、名称、状态或样式无效');
      tracks.set(track.id, track);
    }
    const byKey = new Map(rows.map(row => [key(row), row])), owners = new Map();
    for (const entry of metadata.assignments) {
      if (!entry || !['main', 'extension'].includes(entry.role)
        || (entry.role === 'main' ? entry.track_id !== null : !stable(entry.track_id))
        || !stable(entry.cue_id) || !byKey.has(key(entry)) || owners.has(key(entry))
        || !tracks.has(entry.subtitle_track_id)) fail('字幕归属缺失、重复或引用不存在的对象');
      owners.set(key(entry), entry.subtitle_track_id);
    }
    if (owners.size !== rows.length) fail('每条字幕必须且只能归属一条固定轨道');
    for (const group of groups) {
      if (new Set(group.map(row => owners.get(key(row)))).size > 1) fail('绑定主副字幕必须归属同一轨道');
      const positions = group.map(row => row.cue.subtitle_position).filter(Boolean);
      if (positions.some(p => p.x !== positions[0].x || p.y !== positions[0].y)) fail('绑定主副字幕的位置覆盖必须一致');
    }
    const lanes = new Map();
    for (const row of rows) {
      const lane = JSON.stringify([owners.get(key(row)), row.role, row.track_id]);
      if (!lanes.has(lane)) lanes.set(lane, []);
      lanes.get(lane).push(row.cue);
    }
    for (const cues of lanes.values()) {
      cues.sort((a, b) => a.start - b.start);
      for (let i = 1; i < cues.length; i++) if (cues[i].start < cues[i - 1].end) fail('同轨同角色字幕重叠；请分配到不同轨道');
    }
    return true;
  }

  // Binary-search insertion keeps migration practical for long projects and
  // checks each member's actual interval, not the bound group's empty envelope.
  function insertion(cues, cue) {
    let lo = 0, hi = cues.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (cues[mid].start < cue.start) lo = mid + 1; else hi = mid; }
    return (lo && cues[lo - 1].end > cue.start) || (lo < cues.length && cue.end > cues[lo].start) ? -1 : lo;
  }

  function migrate(input) {
    if (input?.schema === SCHEMA) { validate(input); return clone(input); }
    if (input && Object.hasOwn(input, 'subtitle_tracks')) fail('旧版本中已包含固定轨道字段，无法安全覆盖');
    const prepared = clone(input);
    // Old hand-authored projects may omit the language storage track's ID.
    // Match the ordinary project reader's deterministic legacy ID rule.
    if (prepared?.schema !== layers.SCHEMA && Array.isArray(prepared?.multi_subtitle?.tracks)) {
      const tracks = prepared.multi_subtitle.tracks, reserved = new Set(tracks.map(t => t?.id));
      tracks.forEach((track, i) => {
        if (!track || typeof track !== 'object' || Object.hasOwn(track, 'id')) return;
        const base = `extension-${String(i + 1).padStart(3, '0')}`;
        let id = reserved.has(base) ? `${base}-generated` : base, suffix = 2;
        while (reserved.has(id)) id = `${base}-generated-${suffix++}`;
        track.id = id; reserved.add(id);
      });
    }
    const project = layers.migrate(prepared);
    const rows = sourceRecords(project), groups = bindingGroups(project, rows);
    const legacy = project.subtitle_layers.legacy_overlay;
    const overlayIds = new Set(legacy.cue_ids);
    const overlay = row => row.role === 'main' && overlayIds.has(row.cue_id);
    const visible = row => !overlay(row) || legacy.visible;
    const metadata = { schema: TRACK_SCHEMA, presentation: 'legacy', tracks: [], assignments: [] };
    if (input.overlay_track) {
      metadata.legacy_overlay_settings = clone(input.overlay_track);
      delete metadata.legacy_overlay_settings.segments;
    }
    const slots = [], counts = { main: 0, 'legacy-overlay': 0 };
    function create(origin, enabled) {
      const number = ++counts[origin];
      const oldName = metadata.legacy_overlay_settings?.name;
      const overlayName = (stable(oldName) ? oldName : '原叠加字幕').slice(0, 140).replace(/[\uD800-\uDBFF]$/, '');
      const track = { id: `subtitle-track-${slots.length + 1}`, name: origin === 'main' ? `对白 ${number}` : `${overlayName} ${number}`,
        kind: 'dialogue', origin, enabled, locked: false, collapsed: false, style: { mode: 'inherit' } };
      metadata.tracks.push(track);
      const slot = { track, lanes: new Map() }; slots.push(slot); return slot;
    }
    create('main', true);
    const ordered = groups.map((group, index) => ({ group, index,
      origin: group.some(overlay) ? 'legacy-overlay' : 'main',
      enabled: group.some(visible), start: Math.min(...group.map(r => r.cue.start)) }));
    ordered.sort((a, b) => (a.origin === 'main' ? 0 : 1) - (b.origin === 'main' ? 0 : 1) || a.start - b.start || a.index - b.index);
    const owners = new Map();
    const laneKey = row => JSON.stringify([row.role, row.track_id]);
    for (const entry of ordered) {
      const { group, origin, enabled } = entry;
      let slot = slots.find(s => s.track.origin === origin && s.track.enabled === enabled
        && group.every(row => insertion(s.lanes.get(laneKey(row)) || [], row.cue) >= 0));
      if (!slot) slot = create(origin, enabled);
      for (const row of group) {
        const lane = laneKey(row);
        if (!slot.lanes.has(lane)) slot.lanes.set(lane, []);
        const cues = slot.lanes.get(lane);
        cues.splice(insertion(cues, row.cue), 0, row.cue);
        owners.set(key(row), slot.track.id);
      }
    }
    metadata.assignments = rows.map(row => ({ ...refOf(row), subtitle_track_id: owners.get(key(row)) }));
    project.schema = SCHEMA; project.subtitle_tracks = metadata;
    validate(project);
    return project;
  }

  function createIndex(project) {
    validate(project);
    const tracks = new Map(project.subtitle_tracks.tracks.map(t => [t.id, t]));
    const owners = new Map(project.subtitle_tracks.assignments.map(a => [key(a), a.subtitle_track_id]));
    const rows = sourceRecords(project).map(row => ({ ...row, subtitle_track_id: owners.get(key(row)) }));
    const byKey = new Map(rows.map(row => [key(row), row]));
    return {
      resolve: ref => byKey.get(key(ref)) || null,
      trackFor: ref => tracks.get(owners.get(key(ref))) || null,
      records: ({ subtitleTrackId, role, includeHidden = false, includeDisabled = true } = {}) => rows.filter(row =>
        (!subtitleTrackId || row.subtitle_track_id === subtitleTrackId) && (!role || row.role === role)
        && (includeHidden || (tracks.get(row.subtitle_track_id).enabled && layers.visible(project, row.cue, row.role)))
        && (includeDisabled || !row.cue.disabled)),
    };
  }

  function assign(project, refs, targetId) {
    const index = createIndex(project);
    const target = project.subtitle_tracks.tracks.find(t => t.id === targetId);
    if (!target || target.locked) fail('目标轨道不存在或已锁定');
    const moving = new Set();
    for (const ref of refs) { if (!index.resolve(ref)) fail('字幕引用已失效'); moving.add(key(ref)); }
    for (const group of bindingGroups(project, sourceRecords(project))) {
      if (group.some(row => moving.has(key(row)))) for (const row of group) moving.add(key(row));
    }
    for (const ref of project.subtitle_tracks.assignments) {
      if (moving.has(key(ref)) && index.trackFor(ref).locked) fail('绑定操作包含锁定轨道，未修改工程');
    }
    const next = clone(project);
    for (const ref of next.subtitle_tracks.assignments) if (moving.has(key(ref))) ref.subtitle_track_id = targetId;
    validate(next);
    return next;
  }

  function ownerMap(project) {
    return new Map(project.subtitle_tracks.assignments.map(a => [key(a), a.subtitle_track_id]));
  }
  function boundRefs(project, refs) {
    const wanted = new Set(refs.map(key));
    return bindingGroups(project, sourceRecords(project)).filter(group => group.some(r => wanted.has(key(r)))).flat().map(refOf);
  }
  function assertEditable(project, refs, linked = true) {
    const owners = ownerMap(project), tracks = new Map(project.subtitle_tracks.tracks.map(t => [t.id, t]));
    for (const ref of refs) if (!owners.has(key(ref))) fail('字幕引用已失效');
    for (const ref of linked ? boundRefs(project, refs) : refs) {
      const track = tracks.get(owners.get(key(ref)));
      if (!track) fail('字幕归属已失效');
      if (track.locked) fail(`“${track.name}”已锁定，请先解锁`);
    }
  }
  function reconcile(project, ownerForNewCue) {
    const owners = ownerMap(project);
    project.subtitle_tracks.assignments = sourceRecords(project).map(row => ({ ...refOf(row),
      subtitle_track_id: owners.get(key(row)) || ownerForNewCue(row) }));
    const ids = new Set(project.segments.map(c => c.id));
    project.subtitle_layers.legacy_overlay.cue_ids = project.subtitle_layers.legacy_overlay.cue_ids.filter(id => ids.has(id));
    validate(project);
    return project;
  }
  function assertLocks(before, after) {
    for (const track of before.subtitle_tracks.tracks.filter(t => t.locked)) {
      const other = after.subtitle_tracks.tracks.find(t => t.id === track.id);
      if (other && (JSON.stringify(track.style) !== JSON.stringify(other.style)
        || JSON.stringify(track.position) !== JSON.stringify(other.position))) fail(`“${track.name}”已锁定，不能修改样式或位置`);
    }
    const next = new Map(sourceRecords(after).map(r => [key(r), r])), owners = ownerMap(after);
    const canonical = cue => Object.fromEntries(Object.keys(cue).sort()
      .filter(k => !k.startsWith('_') && !['start_frame', 'end_frame'].includes(k)).map(k => [k, cue[k]]));
    const index = createIndex(before);
    for (const row of index.records({ includeHidden: true })) {
      if (!index.trackFor(row).locked) continue;
      const other = next.get(key(row));
      if (!other || owners.get(key(row)) !== row.subtitle_track_id
        || JSON.stringify(canonical(row.cue)) !== JSON.stringify(canonical(other.cue))) fail(`“${index.trackFor(row).name}”已锁定，操作未提交`);
      const bindings = p => (p.multi_subtitle?.bindings || []).filter(b => row.role === 'main'
        ? b.main_segment_ids?.includes(row.cue_id) : b.track_id === row.track_id && b.extension_segment_ids?.includes(row.cue_id));
      if (JSON.stringify(bindings(before)) !== JSON.stringify(bindings(after))) fail('锁定轨道的绑定不能修改');
    }
  }
  function addTrack(project, kind = 'dialogue', id) {
    validate(project);
    if (!['dialogue', 'annotation'].includes(kind) || !stable(id) || project.subtitle_tracks.tracks.some(t => t.id === id)) fail('新轨道参数无效');
    const next = clone(project), base = kind === 'dialogue' ? '对白' : '画面文字';
    let n = 1;
    while (next.subtitle_tracks.tracks.some(t => t.name === `${base} ${n}`)) n++;
    next.subtitle_tracks.tracks.push({ id, name: `${base} ${n}`, kind, origin: 'main', enabled: true, locked: false, collapsed: false, style: { mode: 'inherit' } });
    return next;
  }
  // Stable lanes cover the whole project, not just cues in the visible time row.
  function layout(project, extensionTrackId, extensionVisible = true) {
    const owners = ownerMap(project), bands = [], positions = new Map();
    for (const track of project.subtitle_tracks.tracks) {
      const secondary = track.show_secondary === true || (extensionVisible && project.multi_subtitle?.tracks
        ?.find(t => t.id === extensionTrackId)?.segments.some(c => owners.get(key({ role: 'extension', track_id: extensionTrackId, cue_id: c.id })) === track.id));
      bands.push({ track, roles: track.collapsed ? [] : ['main', ...(secondary ? ['extension'] : [])], size: track.collapsed ? 1 : secondary ? 2 : 1 });
    }
    const count = bands.reduce((n, b) => n + b.size, 0);
    let offset = 0;
    for (const band of bands) {
      band.top = offset; band.bottom = count - offset - band.size;
      band.roles.forEach((role, i) => positions.set(JSON.stringify([band.track.id, role]), count - offset - i - 1));
      offset += band.size;
    }
    return { count, bands, positions, owners };
  }
  const api = { SCHEMA, TRACK_SCHEMA, key, migrate, validate, createIndex, assign,
    ownerMap, boundRefs, assertEditable, reconcile, assertLocks, addTrack, layout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MSWSubtitleTracks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
