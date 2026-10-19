(function(global){
  'use strict';
  const core=global.MSWFlatSubtitles||(typeof require==='function'?require('./msw-flat-subtitles.js'):null);
  const edit=global.MSWFlatEditing||(typeof require==='function'?require('./msw-flat-editing.js'):null);
  const copy=v=>JSON.parse(JSON.stringify(v));
  const fail=message=>{throw Error(message);};
  const trackCues=(p,id)=>p.subtitles.cues.filter(c=>c.track_id===id).sort((a,b)=>a.content.start-b.content.start||a.id.localeCompare(b.id));
  function scope(p,trackId,selectedIds=null,{includeDisabled=true,allTracks=false}={}) {
    const selected=selectedIds==null?null:new Set(selectedIds);
    if(allTracks&&trackId==='*')return p.subtitles.cues.filter(c=>(!selected||selected.has(c.id))&&(includeDisabled||!c.content.disabled));
    const track=p.subtitles.tracks.find(t=>t.id===trackId);
    if(!track)fail('请选择作用轨道');
    return trackCues(p,trackId).filter(c=>(!selected||selected.has(c.id))&&(includeDisabled||!c.content.disabled));
  }
  const graphemes=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
  function visibleCharacterCount(text) {
    const value=String(text??'').replace(/\s/gu,'');
    return graphemes?[...graphemes.segment(value)].length:Array.from(value).length;
  }
  function cleanupMatches(cues,{mode='length',comparison='lte',threshold=0,keyword=''}={}) {
    if(mode==='all')return cues;
    if(mode==='keyword') {
      const term=String(keyword).trim().toLocaleLowerCase();if(!term)fail('请输入要清理的关键词');
      return cues.filter(c=>c.content.text.toLocaleLowerCase().includes(term));
    }
    if(mode!=='length'||!['lte','gte'].includes(comparison)||threshold===''||!Number.isSafeInteger(Number(threshold))||Number(threshold)<0)fail('字数阈值须为大于等于 0 的整数');
    return cues.filter(c=>comparison==='gte'?visibleCharacterCount(c.content.text)>=Number(threshold):visibleCharacterCount(c.content.text)<=Number(threshold));
  }
  function refreshOffsets(p){const cues=new Map(p.subtitles.cues.map(c=>[c.id,c]));
    for(const b of p.subtitles.bindings)for(const edge of ['start','end'])b[edge+'_offset_ms']=cues.get(b.target_id).content[edge]-cues.get(b.source_id).content[edge];
  }
  function checkLocks(before,after){
    const next=new Map(after.subtitles.cues.map(c=>[c.id,c]));
    const changed=before.subtitles.cues.filter(c=>JSON.stringify(c)!==JSON.stringify(next.get(c.id))).map(c=>c.id);
    edit.editable(before,changed);
  }
  function cleanup(p,ids){const next=edit.remove(p,ids);checkLocks(p,next);return next;}
  function time(p,ids,transform,{linked=true,utils=global.AsrEditorUtils}={}) {
    core.validate(p);const selected=new Set(ids),changes=new Map(),lookup=new Map(p.subtitles.cues.map(c=>[c.id,c]));
    for(const id of selected){const c=lookup.get(id);if(!c)fail('字幕已不存在');const range=transform(copy(c.content));
      if(range)changes.set(id,{start:Math.round(range.start),end:Math.round(range.end)});}
    if(linked)for(const b of p.subtitles.bindings){const a=changes.get(b.source_id),z=changes.get(b.target_id);
      if(a&&!z){const c=lookup.get(b.source_id).content,other=lookup.get(b.target_id).content;changes.set(b.target_id,{start:other.start+a.start-c.start,end:other.end+a.end-c.end});}
      if(z&&!a){const c=lookup.get(b.target_id).content,other=lookup.get(b.source_id).content;changes.set(b.source_id,{start:other.start+z.start-c.start,end:other.end+z.end-c.end});}
    }
    for(const [id,range] of changes){const c=lookup.get(id).content;if(c.start===range.start&&c.end===range.end)changes.delete(id);}
    // Even an unlinked move changes the binding offsets on both tracks.
    const affectedLinks=p.subtitles.bindings.filter(b=>changes.has(b.source_id)||changes.has(b.target_id));
    edit.editable(p,[...changes.keys(),...affectedLinks.flatMap(b=>[b.source_id,b.target_id])]);const next=copy(p);
    for(const c of next.subtitles.cues){const range=changes.get(c.id);if(!range)continue;const old=c.content;
      if(!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.end<=range.start||range.end-range.start<(old.items?.length||0))fail('时间超出有效范围或字词最短时长；整批未修改');
      const factor=(range.end-range.start)/(old.end-old.start);
      old.items=(old.items||[]).map(item=>({...item,start:Math.round(range.start+(item.start-old.start)*factor),end:Math.round(range.start+(item.end-old.start)*factor)}));
      Object.assign(old,range,{_dirty:true});utils?.normalizeFrameItemTimingRanges(old);
      for(const field of ['color','sticker'])if(old[field])Object.assign(old[field],range);
      edit.frame(next,old);
    }
    refreshOffsets(next);core.validate(next);
    return {project:next,ids:[...selected],changed:[...changes.keys()].filter(id=>selected.has(id)).length,linked:[...changes.keys()].filter(id=>!selected.has(id)).length};
  }
  // Text-only operations never transfer wording or erase a bound partner.
  function texts(p,changes,{utils=global.AsrEditorUtils}={}) {
    core.validate(p);const changed=changes.filter(change=>{const c=edit.cue(p,change.id);if(!c)fail('字幕已不存在');return c.content.text!==change.text;});
    edit.editable(p,changed.map(c=>c.id));const next=copy(p);
    for(const change of changed){const c=edit.cue(next,change.id),before=c.content;
      const mapped=change.text?utils.applyTimedTextEdit([before],[change.text])?.[0]:null;
      c.content={...before,text:change.text,items:copy(mapped?.items||[]),_dirty:true};edit.frame(next,c.content);
    }
    core.validate(next);return {project:next,ids:changes.map(c=>c.id),changed:changed.length};
  }
  function textSources(cues,p){return cues.map(c=>{const content=copy(c.content);
    for(const field of ['color','sticker'])if(content[field+'_ref']){const target=edit.cue(p,content[field+'_ref'].cue_id);content[field]=copy(target.content[field]);delete content[field+'_ref'];}
    return {...content,id:c.id};
  });}
  function draft(p,trackId,snapshot,sourceIds,segments,report,{makeId}={}) {
    core.validate(p);
    if(JSON.stringify(trackCues(p,trackId))!==JSON.stringify(snapshot))fail('本轨字幕在编辑期间发生了变化，请重新载入后再应用');
    const source=new Set(sourceIds),nextIds=new Set(segments.map(c=>c.id)),affected=new Set(sourceIds.filter(id=>!nextIds.has(id)));
    for(const i of report.structure?.affectedSourceIndexes||[])affected.add(sourceIds[i]);
    for(const segment of segments){const original=edit.cue(p,segment.id);
      if(original&&(original.content.start!==segment.start||original.content.end!==segment.end))affected.add(segment.id);}
    if(p.subtitles.bindings.some(b=>affected.has(b.source_id)||affected.has(b.target_id)))fail('此修改会改变已绑定字幕的行结构；请使用联动切分／合并或先手动解绑');
    // Selected/non-disabled rows separated by excluded rows must never merge
    // through those rows, even if the resulting timing could fit by chance.
    const indexes=new Map(snapshot.map((c,i)=>[c.id,i]));
    for(const out of report.structure?.outputMeta||[]){const positions=(out.sourceIndexes||[]).map(i=>indexes.get(sourceIds[i])).sort((a,b)=>a-b);
      if(positions.some((value,i)=>i&&value!==positions[i-1]+1))fail('不能跨过范围外字幕合并；请扩大选区或分别处理');}
    edit.editable(p,[...source]);let next=copy(p);const used=new Set(p.subtitles.cues.map(c=>c.id));let serial=0;
    const idFactory=makeId||(()=>{let id;do{id='text-preview-'+(++serial);}while(used.has(id));used.add(id);return id;});
    const removed=[...source].filter(id=>!nextIds.has(id));
    if(removed.length)next=cleanup(next,removed);
    const right=new Set(next.subtitle_view?.secondary_cue_ids||[]),published=[],newIds=[];
    segments.forEach((segment,i)=>{
      const sourceIndex=report.structure?.outputMeta?.[i]?.sourceIndexes?.[0]??i;
      const original=edit.cue(p,source.has(segment.id)?segment.id:sourceIds[sourceIndex]);
      if(!original)fail('无法确定字幕来源；未应用修改');
      const content=copy(segment);delete content.id;content.items||=[];
      const id=source.has(segment.id)?segment.id:idFactory('cue');newIds.push(id);
      if(id===original.id&&content.start===original.content.start&&content.end===original.content.end)
        for(const field of ['color','sticker'])if(original.content[field+'_ref']&&!removed.includes(original.content[field+'_ref'].cue_id)){
          content[field+'_ref']=copy(original.content[field+'_ref']);delete content[field];
        }
      if(id===original.id&&JSON.stringify(original.content)===JSON.stringify(content))published.push(copy(original));
      else {content._dirty=true;edit.frame(next,content);published.push({...copy(original),id,content});}
      if(p.subtitle_view?.secondary_cue_ids?.includes(original.id))right.add(id);
    });
    for(const id of removed)right.delete(id);
    next.subtitles.cues=next.subtitles.cues.filter(c=>!source.has(c.id)).concat(published);
    next.subtitle_view={...next.subtitle_view,secondary_cue_ids:[...right]};
    refreshOffsets(next);core.validate(next);checkLocks(p,next);return {project:next,ids:newIds,changed:report.stats.changedSegments};
  }
  const api={scope,trackCues,time,texts,textSources,draft,cleanup,cleanupMatches,visibleCharacterCount};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MSWBatchEditing=api;
})(typeof globalThis!=='undefined'?globalThis:this);
