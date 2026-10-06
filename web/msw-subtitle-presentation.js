// Shared deterministic layout contract. Python subtitle_presentation.py mirrors it.
(function(global) {
  'use strict';
  const key=(role,id)=>JSON.stringify([role,id]);
  function visible(project,cue) {
    const legacy=project.subtitle_layers?.legacy_overlay;
    return !cue.disabled && !(legacy?.visible===false && legacy.cue_ids.includes(cue.id));
  }
  function rows(project,target='both') {
    const result=[];
    if(target!=='secondary') for(const cue of project.segments||[]) if(visible(project,cue)) result.push({cue,role:'main',key:key('main',cue.id)});
    if(target!=='main'&&project.multi_subtitle?.enabled) for(const cue of project.multi_subtitle.tracks?.[0]?.segments||[]) if(!cue.disabled) result.push({cue,role:'secondary',key:key('secondary',cue.id)});
    return result;
  }
  function layout(project,styles,target='both',width=1920) {
    const entries=rows(project,target), byMain=new Map(), bySecondary=new Map();
    for(const b of project.multi_subtitle?.bindings||[]) {
      if(b.track_id!==project.multi_subtitle?.tracks?.[0]?.id)continue;
      const group=key('binding',b.id);
      for(const id of b.main_segment_ids||[])byMain.set(id,group);
      for(const id of b.extension_segment_ids||[])bySecondary.set(id,group);
    }
    const groups=new Map(), offsets=new Map();
    for(const entry of entries) {
      const id=(entry.role==='main'?byMain:bySecondary).get(entry.cue.id)||entry.key;
      if(!groups.has(id))groups.set(id,{id,start:entry.cue.start,end:entry.cue.end,rows:[]});
      const group=groups.get(id);group.start=Math.min(group.start,entry.cue.start);group.end=Math.max(group.end,entry.cue.end);group.rows.push(entry);
    }
    const settings=project.subtitle_layers?.presentation||{}, lanes=[], heights=[];
    const ordered=[...groups.values()].sort((a,b)=>a.start-b.start);
    for(const group of ordered) {
      let lane=lanes.findIndex(end=>end<=group.start);if(lane<0)lane=lanes.length;
      lanes[lane]=group.end;group.lane=lane;
      group.rows.sort((a,b)=>(a.role==='main'?0:1)-(b.role==='main'?0:1)||a.cue.start-b.cue.start);
      let top=Infinity, bottom=-Infinity, nextBottom=Infinity;
      for(const entry of [...group.rows].reverse()) {
        const s=styles[entry.role], size=s.font_size, capacity=Math.max(1,Math.floor(width*s.width/(size*.55)));
        const lines=String(entry.cue.text||'').split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil([...line].reduce((sum,c)=>sum+(c.charCodeAt(0)>255?2:1),0)/capacity)),0);
        const anchor=s.y*1080, edge=Math.min(anchor,nextBottom);
        entry.localOffset=anchor-edge;nextBottom=edge-size*1.2*lines;
        top=Math.min(top,nextBottom);bottom=Math.max(bottom,edge);
      }
      group.height=bottom-top+(settings.gap??12);heights[lane]=Math.max(heights[lane]||0,group.height);
    }
    for(const group of ordered) {
      const offset=settings.mode==='manual'?0:(settings.order==='earlier-top'?heights.slice(group.lane+1):heights.slice(0,group.lane)).reduce((n,h)=>n+h,0);
      for(const entry of group.rows) offsets.set(entry.key,{offset:offset+(settings.mode==='manual'?0:entry.localOffset),lane:group.lane,group:group.id});
    }
    return {entries,offsets,groups:ordered};
  }
  function mergedSrtRows(project,target='both') {
    const entries=rows(project,target), starts=new Map(), ends=new Map(), active=new Set(), result=[];
    const byMain=new Map();for(const b of project.multi_subtitle?.bindings||[]) for(const id of b.extension_segment_ids||[])byMain.set(id,b.main_segment_ids?.[0]);
    const order=new Map((project.segments||[]).map((c,i)=>[c.id,i]));
    const sorted=[...entries].sort((a,b)=>(order.get(a.role==='main'?a.cue.id:byMain.get(a.cue.id))??1e9)-(order.get(b.role==='main'?b.cue.id:byMain.get(b.cue.id))??1e9)||(a.role==='main'?0:1)-(b.role==='main'?0:1)||a.cue.start-b.cue.start);
    sorted.forEach((e,i)=>{for(const [map,time]of [[starts,e.cue.start],[ends,e.cue.end]]){if(!map.has(time))map.set(time,[]);map.get(time).push(i);}});
    let previous=0;
    for(const at of [...new Set([...starts.keys(),...ends.keys()])].sort((a,b)=>a-b)) {
      if(at>previous&&active.size)result.push({start:previous,end:at,text:[...active].sort((a,b)=>a-b).map(i=>sorted[i].cue.text).join('\n')});
      for(const i of ends.get(at)||[])active.delete(i);for(const i of starts.get(at)||[])active.add(i);previous=at;
    }
    return result;
  }
  global.MSWSubtitlePresentation=Object.freeze({key,visible,rows,layout,mergedSrtRows});
})(typeof window==='undefined'?globalThis:window);
