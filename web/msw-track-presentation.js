// Fixed-track geometry. Measurement is supplied by the renderer, in 1080p units.
// A group's placement is computed once for its whole lifetime, never per frame.
(function(global) {
  'use strict';
  const core = typeof module !== 'undefined' && module.exports ? require('./msw-subtitle-tracks.js') : global.MSWSubtitleTracks;
  const layers = typeof module !== 'undefined' && module.exports ? require('./msw-subtitle-layers.js') : global.MSWSubtitleLayers;
  const intersect = (a,b) => a.x < b.x+b.width && b.x < a.x+a.width && a.y < b.y+b.height && b.y < a.y+a.height;
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  function position(value) { return value && Object.keys(value).length === 2 && ['x','y'].every(k => finite(value[k]) && value[k] >= 0 && value[k] <= 1); }
  function styleFor(project, track, proof = null) {
    return global.MSWProjectStyle.normalize(proof || (track.style.mode === 'snapshot' ? track.style.value : project.preview?.project_style) || global.MSWProjectStyle.defaults());
  }
  function layout(project, {width = 1920, languageId = project.multi_subtitle?.tracks?.[0]?.id, measure, resolveStyle = t => styleFor(project,t), gap = project.subtitle_layers?.presentation?.gap ?? 12} = {}) {
    const index = core.createIndex(project), tracks = project.subtitle_tracks.tracks;
    const available = index.records({includeDisabled:false}).filter(r => r.role === 'main' || project.multi_subtitle?.enabled && r.track_id === languageId);
    const lookup = new Map(available.map(r => [core.key(r),r])), used = new Set(), groups = [];
    const add = refs => {
      const rows = refs.map(r => lookup.get(core.key(r))).filter(Boolean);
      if (!rows.length) return;
      for (const row of rows) used.add(core.key(row));
      const track = tracks.find(t => t.id === rows[0].subtitle_track_id), style = resolveStyle(track);
      const group = {id:core.key(rows[0]), trackId:track.id, kind:track.kind, rank:tracks.indexOf(track), rows, style};
      group.start = Math.min(...rows.map(r=>r.cue.start)); group.end = Math.max(...rows.map(r=>r.cue.end));
      const pair = style.pairLayout || {order:'main-above',gap:0}, upper = pair.order === 'secondary-above' ? 'extension' : 'main';
      rows.sort((a,b)=>(a.role===upper?0:1)-(b.role===upper?0:1));
      for (const row of rows) {
        row.style = style[row.role === 'main' ? 'main' : 'secondary'];
        row.size = measure(row,style,width);
        if (!row.size || !['width','height'].every(k=>finite(row.size[k])&&row.size[k]>=0)) throw Error('字幕字体测量失败');
      }
      group.width = Math.max(...rows.map(r=>r.size.width),1);
      rows[0].localY = 0;
      if (rows.length === 2) rows[1].localY = Math.max(1, (rows[0].size.height-rows[1].size.height)/2+1, rows[0].size.height+pair.gap);
      group.height = Math.max(...rows.map(r=>r.localY+r.size.height),1);
      const explicit = rows.find(r=>r.cue.subtitle_position)?.cue.subtitle_position || track.position;
      group.position = explicit || (track.kind === 'annotation' ? {x:.5,y:.08} : null);
      const lowerStyle = rows.at(-1).style, alignment = Number(lowerStyle.alignment)||2;
      const horizontal = (alignment-1)%3, vertical = Math.floor((alignment-1)/3);
      group.x = explicit || track.kind === 'annotation' ? group.position.x*width-group.width/2
        : horizontal===0 ? lowerStyle.marginL||0 : horizontal===2 ? width-(lowerStyle.marginR||0)-group.width : (width-group.width)/2;
      group.y = group.position ? group.position.y*1080 : vertical===2 ? lowerStyle.marginV||0
        : vertical===1 ? (1080-group.height)/2 : 1080-(lowerStyle.marginV||0)-group.height;
      groups.push(group);
    };
    for (const binding of project.multi_subtitle?.bindings || []) if ((binding.track_id ?? languageId) === languageId) add([
      {role:'main',track_id:null,cue_id:binding.main_segment_ids?.[0] ?? binding.main_segment_id},
      {role:'extension',track_id:languageId,cue_id:binding.extension_segment_ids?.[0] ?? binding.extension_segment_id}]);
    for (const row of available) if (!used.has(core.key(row))) add([row]);
    // Pack actual occupied intervals, including gaps between offset partners.
    // Same-rank groups never depend on one another: continuous speech cannot
    // accumulate an ever-growing offset through a chain of past neighbours.
    const ordered = groups.slice().sort((a,b)=>a.rank-b.rank||a.start-b.start||a.id.localeCompare(b.id));
    const cueRows = ordered.flatMap(g=>g.rows.map(r=>({start:r.cue.start,end:r.cue.end,group:g})));
    const intervals = new layers.IntervalIndex(cueRows);
    const neighbours = g => new Set(g.rows.flatMap(r=>intervals.range(r.cue.start,r.cue.end).map(i=>cueRows[i].group)));
    for (const g of ordered) {
      if (g.kind === 'annotation' || g.position) {g.lane=0;continue;}
      const blocked = new Set([...neighbours(g)].filter(other=>other!==g && other.trackId===g.trackId && !other.position).map(other=>other.lane));
      let lane=0;while(blocked.has(lane))lane++;g.lane=lane;
    }
    ordered.sort((a,b)=>a.rank-b.rank||a.lane-b.lane||a.start-b.start||a.id.localeCompare(b.id));
    for (const g of ordered) {
      if (g.kind !== 'dialogue' || g.position) continue;
      for (const other of neighbours(g)) if (other.kind==='dialogue' && !other.position
        && (other.rank<g.rank || other.rank===g.rank && other.lane<g.lane)) g.y=Math.min(g.y,other.y-gap-g.height);
    }
    const entries = [];
    for (const group of ordered) for (const row of group.rows) {
      const align = ((Number(row.style.alignment)||2)-1)%3;
      entries.push({...row, key:core.key(row), group, x:group.x+(align===0?0:align===2?group.width-row.size.width:(group.width-row.size.width)/2),y:group.y+row.localY,width:row.size.width,height:row.size.height});
    }
    return {groups:ordered,entries,width,height:1080};
  }
  function warnings(layout,time) {
    const active=layout.entries.filter(r=>r.cue.start<=time&&time<r.cue.end), issues=[];
    for (const row of active) if (row.x<0||row.y<0||row.x+row.width>layout.width||row.y+row.height>1080) issues.push({type:'outside',groups:[row.group.id]});
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++) {
      const a=active[i],b=active[j];
      if(a.group===b.group || a.group.kind!=='annotation'&&b.group.kind!=='annotation')continue;
      if(intersect(a,b))issues.push({type:'collision',groups:[a.group.id,b.group.id]});
    }
    return issues;
  }
  const api={position,styleFor,layout,warnings};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  global.MSWTrackPresentation=api;
})(typeof window==='undefined'?globalThis:window);
