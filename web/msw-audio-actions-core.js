// Pure batch plans. UI commits each accepted plan as one history entry.
(function (global) {
  'use strict';
  function gains(clips, value, mode) {
    if (!Number.isFinite(value)) throw Error('请输入有效的增益数值');
    const changes = clips.map(clip => ({id: clip.id, gain_db: mode === 'offset' ? clip.gain_db + value : value}));
    const invalid = changes.filter(clip => clip.gain_db < -60 || clip.gain_db > 12);
    if (invalid.length) throw Error(`增益须在 −60 至 +12 dB：${invalid.map(c => clips.find(x => x.id === c.id).label || c.id).join('、')}`);
    return new Map(changes.map(c => [c.id, c.gain_db]));
  }
  const overlaps = (a, b) => a.start < b.end && b.start < a.end;
  function fill(project, clips, normalize = cue => cue) {
    const assets = new Map((project.msw?.assets || []).map(a => [a.id, a]));
    const rows = clips.map(clip => {
      const asset = assets.get(clip.asset_id), generation = asset?.generation || {};
      const filename = generation.text_origin === 'filename' || generation.provider === 'imported';
      const text = String(filename ? generation.filename || clip.label || generation.display_text || ''
        : generation.display_text || asset?.source_ref?.text || '').trim();
      const row = {id: clip.id, label: clip.label || text || clip.id, reason: '', placeholder: filename};
      if (!asset || !text) { row.reason = '没有可用的文字或文件名'; return row; }
      if ([...text].length > 600) { row.reason = '文字超过 600 字符，请先编辑文字'; return row; }
      row.cue = normalize({id: global.MSWProject.id('cue'), start: clip.start_ms,
        end: Math.max(clip.start_ms + 1, Math.round(global.MSWAudio.end(clip, asset))), text});
      row.note = filename ? '已生成文件名占位字幕，请填写真实文字' : clip.source_in_sample > 0 || clip.source_out_sample < asset.sample_count
        ? '已补齐；音频已裁剪，请核对文字' : '已补齐';
      return row;
    });
    const candidates = rows.filter(row => row.cue);
    for (const row of candidates) {
      if ((project.segments || []).some(cue => overlaps(cue, row.cue))) row.reason = '与现有主字幕重叠';
      if (candidates.some(other => other !== row && overlaps(other.cue, row.cue))) row.reason = '所选贴片彼此重叠';
    }
    const accepted = rows.filter(row => row.cue && !row.reason);
    const segments = global.MSWProject.clone(project.segments || []);
    const heads = new Map(segments.map((cue, index) => [index, cue.id]));
    segments.push(...accepted.map(row => row.cue)); segments.sort((a,b) => a.start-b.start || a.end-b.end);
    const indices = new Map(segments.map((cue,index) => [cue.id,index]));
    for (const cue of segments) for (const field of ['color_ref', 'sticker_ref']) {
      if (cue[field] && heads.has(cue[field].headIdx)) cue[field].headIdx = indices.get(heads.get(cue[field].headIdx));
    }
    return {segments, count: accepted.length, rows: rows.map(row => ({...row, reason: row.reason || row.note}))};
  }
  const recipeFields = {
    qwen: ['provider','region','model','model_type','voice','language_type','instructions','optimize_instructions'],
    yukkuri: ['provider','model','voice','language_type','speed'],
    indextts: ['provider','model','voice','language_type','speaker_ref','emotion_ref','emotion_mode','emotion_weight','emotion_vector','emotion_text','emotion_random','duration_factor','max_text_tokens_per_segment','do_sample','top_p','top_k','temperature','length_penalty','num_beams','repetition_penalty','max_mel_tokens'],
  };
  function canRegenerate(g) {
    return !!(recipeFields[g.provider] && g.model && g.language_type
      && (g.provider !== 'qwen' || (g.region && g.voice))
      && (g.provider !== 'yukkuri' || (g.voice && g.speed))
      && (g.provider !== 'indextts' || g.speaker_ref));
  }
  function regeneration(project, clips) {
    const assets = new Map((project.msw?.assets || []).map(a => [a.id,a])), groups = new Map(), rows = [];
    for (const clip of clips) {
      const asset = assets.get(clip.asset_id), g = asset?.generation || {}, fields = recipeFields[g.provider];
      const row = {id: clip.id, label: clip.label || clip.id, original: global.MSWProject.clone(clip), reason: ''};
      rows.push(row);
      if (!canRegenerate(g)) {
        row.reason = '缺少原合成配置或属于外部音频'; continue;
      }
      const text = g.display_text || asset.source_ref?.text;
      if (typeof text !== 'string' || !text.trim() || [...text].length > 600) { row.reason = '原合成文字缺失或超过 600 字符'; continue; }
      const recipe = Object.fromEntries(fields.filter(key => key in g).map(key => [key,g[key]]));
      const signature = JSON.stringify(recipe), key = global.MSWProject.id('entry');
      row.key = key;
      const source = asset.source_ref || {};
      const entry = {key, id: global.MSWProject.id('draft'), track_id: null, kind:'editor_text', text,
        start:clip.start_ms, end:Math.max(clip.start_ms+1,Math.round(global.MSWAudio.end(clip,asset)))};
      if (source.pronunciation_override) entry.pronunciation_override = source.pronunciation_override;
      if (['yukkuri','indextts'].includes(g.provider) && g.spoken_text?.trim()) entry.spoken_text = g.spoken_text;
      if (!groups.has(signature)) groups.set(signature, {recipe, entries:[], rows:[]});
      groups.get(signature).entries.push(entry); groups.get(signature).rows.push(row);
    }
    return {groups:[...groups.values()],rows};
  }
  function replacements(extension, rows) {
    const assets = new Map((extension.assets || []).map(a => [a.id,a])), next = new Map();
    for (const row of rows) {
      if (!row.assetId || row.reason) continue;
      const clip = extension.audio_clips.find(c => c.id === row.id), asset = assets.get(row.assetId);
      if (!clip || JSON.stringify(clip) !== JSON.stringify(row.original)) { row.reason = '目标贴片已变化，新结果保留在素材库'; continue; }
      if (!asset) { row.reason = '新素材已移除，保留原贴片'; continue; }
      next.set(row.id,{...clip,asset_id:asset.id,source_in_sample:0,source_out_sample:asset.sample_count});
    }
    // Removing one replacement restores its original duration; repeat until the
    // complete final arrangement fits, never make acceptance depend on order.
    while (next.size) {
      const clips = extension.audio_clips.map(c => next.get(c.id) || c), events = [];
      for (const c of clips) { const a=assets.get(c.asset_id); if (a) events.push([c.start_ms,1,c.id],[global.MSWAudio.end(c,a),-1,c.id]); }
      events.sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
      const active = new Set(), reject = new Set();
      for (const [,delta,id] of events) {
        if (delta < 0) active.delete(id); else active.add(id);
        if (active.size > global.MSWAudio.MAX_LANES) for (const candidate of active) if (next.has(candidate)) reject.add(candidate);
      }
      if (!reject.size) break;
      for (const id of reject) { next.delete(id); rows.find(row=>row.id===id).reason='超过三层重叠，新结果保留在素材库'; }
    }
    return next;
  }
  global.MSWAudioActions = Object.freeze({gains, fill, regeneration, replacements, canRegenerate});
})(typeof window === 'undefined' ? globalThis : window);
