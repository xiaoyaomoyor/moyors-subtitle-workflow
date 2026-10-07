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
    project=global.MSWProjectStyle?.renderProject(project)||project;
    const pair=project.preview?.project_style?.pairLayout||project.preview?.subtitle_pair_layout;
    const entries=rows(project,pair?'both':target), byMain=new Map(), bySecondary=new Map();
    for(const b of project.multi_subtitle?.bindings||[]) {
      if(b.track_id!==project.multi_subtitle?.tracks?.[0]?.id)continue;
      const group=key('binding',b.id);
      for(const id of b.main_segment_ids||[])byMain.set(id,group);
      for(const id of b.extension_segment_ids||[])bySecondary.set(id,group);
    }
    const groups=new Map(), offsets=new Map(),unboundGroups=new Map();
    if(pair){
      // Unbound translations need not have identical timestamps. Connected
      // overlapping intervals form a presentation group without creating bindings.
      const unbound=entries.filter(e=>!(e.role==='main'?byMain:bySecondary).has(e.cue.id)).sort((a,b)=>a.cue.start-b.cue.start);
      let component=[],end=-Infinity;
      const flush=()=>{if(component.some(e=>e.role==='main')&&component.some(e=>e.role==='secondary'))for(const e of component)unboundGroups.set(e.key,key('paired-overlap',component[0].key));};
      for(const e of unbound){if(e.cue.start>=end){flush();component=[];end=-Infinity;}component.push(e);end=Math.max(end,e.cue.end);}flush();
    }
    for(const entry of entries) {
      const id=(entry.role==='main'?byMain:bySecondary).get(entry.cue.id)||unboundGroups.get(entry.key)||entry.key;
      if(!groups.has(id))groups.set(id,{id,start:entry.cue.start,end:entry.cue.end,rows:[]});
      const group=groups.get(id);group.start=Math.min(group.start,entry.cue.start);group.end=Math.max(group.end,entry.cue.end);group.rows.push(entry);
    }
    const settings=project.subtitle_layers?.presentation||{}, lanes=[], heights=[];
    const ordered=[...groups.values()].sort((a,b)=>a.start-b.start);
    for(const group of ordered) {
      let lane=lanes.findIndex(end=>end<=group.start);if(lane<0)lane=lanes.length;
      lanes[lane]=group.end;group.lane=lane;
      group.paired=!!pair&&group.rows.some(e=>e.role==='main')&&group.rows.some(e=>e.role==='secondary');
      const upper=group.paired&&pair.order==='secondary-above'?'secondary':'main';
      group.rows.sort((a,b)=>(a.role===upper?0:1)-(b.role===upper?0:1)||a.cue.start-b.cue.start);
      const height=entry=>{
        const s=styles[entry.role],capacity=Math.max(1,Math.floor(width*s.width/(s.font_size*.55)));
        const lines=String(entry.cue.text||'').split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil([...line].reduce((sum,c)=>sum+(c.charCodeAt(0)>255?2:1),0)/capacity)),0);
        return s.font_size*1.2*(s.scale_y??100)/100*lines;
      };
      if(group.paired){
        // Consecutive cues reuse a lane; a long translation spanning several
        // source cues must not stack the entire sequence vertically.
        const bands={};
        for(const role of ['main','secondary']){
          const ends=[],sizes=[],rows=group.rows.filter(e=>e.role===role);
          for(const e of rows){let lane=ends.findIndex(end=>end<=e.cue.start);if(lane<0)lane=ends.length;ends[lane]=e.cue.end;e.pairLane=lane;sizes[lane]=Math.max(sizes[lane]||0,height(e));}
          bands[role]={rows,sizes,height:sizes.reduce((a,b)=>a+b,0)};
        }
        const lower=upper==='main'?'secondary':'main',base=styles[lower].y*1080;
        const distance=Math.max(1,(bands[lower].height-bands[upper].height)/2+1,bands[lower].height+pair.gap);
        for(const role of [lower,upper])for(const e of bands[role].rows){
          const edge=base-(role===upper?distance:0)-bands[role].sizes.slice(e.pairLane+1).reduce((a,b)=>a+b,0);
          e.localOffset=styles[role].y*1080-edge;
        }
        group.height=Math.max(bands[lower].height,distance+bands[upper].height)+(settings.gap??12);
        heights[lane]=Math.max(heights[lane]||0,group.height);continue;
      }
      let top=Infinity, bottom=-Infinity, nextBottom=Infinity;
      for(const entry of [...group.rows].reverse()) {
        const anchor=styles[entry.role].y*1080,edge=Math.min(anchor,nextBottom);
        entry.localOffset=anchor-edge;nextBottom=edge-height(entry);
        top=Math.min(top,nextBottom);bottom=Math.max(bottom,edge);
      }
      group.height=bottom-top+(settings.gap??12);heights[lane]=Math.max(heights[lane]||0,group.height);
    }
    for(const group of ordered) {
      const offset=settings.mode==='manual'?0:(settings.order==='earlier-top'?heights.slice(group.lane+1):heights.slice(0,group.lane)).reduce((n,h)=>n+h,0);
      for(const entry of group.rows)if(target==='both'||target===entry.role)offsets.set(entry.key,{offset:offset+(settings.mode==='manual'&&!group.paired?0:entry.localOffset),lane:group.lane,group:group.id});
    }
    return {entries:entries.filter(e=>target==='both'||target===e.role),offsets,groups:ordered};
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
