// Native v4 processing plans. No editable state is reconstructed from DATA.
(function(global){
  'use strict';
  const core=global.MSWFlatSubtitles||(typeof require==='function'?require('./msw-flat-subtitles.js'):null);
  const edit=global.MSWFlatEditing||(typeof require==='function'?require('./msw-flat-editing.js'):null);
  const speaker=global.MSWSpeaker||(typeof require==='function'?require('./msw-speaker.js'):null);
  const copy=v=>JSON.parse(JSON.stringify(v));
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  const overlap=(a,b)=>a.start<b.end&&b.start<a.end;
  const capture=p=>{core.validate(p);const model=copy(p.subtitles);delete model.migration;return {project_id:p.msw.project_id,project_schema:core.SCHEMA,flat_model:model};};
  const native=s=>({schema:core.SCHEMA,subtitles:s.flat_model});
  function writable(p,id){const t=edit.track(p,id);if(!t||!t.enabled||t.locked)throw Error('请选择已启用且未锁定的目标字幕轨道');return t;}
  function sources(p,ids){if(!ids.length)throw Error('请先选择要处理的字幕');return ids.map(id=>{const c=edit.cue(p,id),t=c&&edit.track(p,c.track_id);if(!c||c.hidden||c.content.disabled||!t.enabled||!c.content.text.trim())throw Error('所选字幕包含隐藏、禁用或空白内容，请调整选择');return c;});}
  function translation(p,ids,target){writable(p,target);const rows=sources(p,ids);const entries=rows.map(c=>{
    if(c.track_id===target)throw Error('译文请选择另一条轨道');
    const b=edit.relation(p,c.id),peer=edit.partner(p,c.id);
    if(peer&&peer.track_id!==target)throw Error('所选字幕已对应其他轨道；请选择对应轨道，或先解除对应关系');
    return {source:{id:c.id,...copy(c.content)},target:peer?{id:peer.id,...copy(peer.content)}:null,binding_id:b?.id||null};
  });
    const intervals=[...p.subtitles.cues.filter(c=>c.track_id===target).map(c=>c.content),...entries.filter(e=>!e.target).map(e=>e.source)].sort((a,b)=>a.start-b.start);
    if(intervals.some((c,i)=>i&&c.start<intervals[i-1].end))throw Error('译文时间与目标轨道的字幕重叠；请使用新轨道或先调整目标字幕');
    return {...capture(p),subtitle_track_id:target,track_id:target,entries};}
  function tts(p,ids,makeId){return {...capture(p),entries:sources(p,ids).map(c=>({key:makeId('tts-source'),id:c.id,subtitle_cue_id:c.id,track_id:c.track_id,kind:'subtitle',...Object.fromEntries(['start','end','text'].map(k=>[k,c.content[k]]))}))};}
  function affected(p,track,span){return p.subtitles.cues.filter(c=>c.track_id===track&&overlap(c.content,span));}
  function asr(p,media,track,range){writable(p,track);const duration=media?.metadata?.duration_ms;
    if(!duration||!media.metadata.audio_tracks?.length||!media.revision)throw Error('请先导入包含音轨的媒体');
    const span=range||{start:0,end:duration};
    if(![span.start,span.end].every(Number.isSafeInteger)||span.start<0||span.end>duration||span.start>=span.end)throw Error('识别范围必须位于源媒体内');
    const rows=affected(p,track,span);
    if(rows.some(c=>c.content.start<span.start||c.content.end>span.end))throw Error('范围边界穿过现有字幕；请扩展范围或使用新轨道');
    if(rows.some(c=>edit.partner(p,c.id)))throw Error('范围内字幕已有对应关系；请识别到新轨道，或先解除对应关系');
    return {...capture(p),subtitle_track_id:track,mode:range?'range':'whole',range:copy(span),targets:rows.map(c=>({id:c.id,...copy(c.content)})),
      source:{...Object.fromEntries(['id','revision','reference','name','audio_index'].map(k=>[k,media[k]])),duration_ms:duration}};
  }
  function checkBase(p,job){core.validate(p);const ready=job.status==='succeeded'||job.kind==='tts'&&['failed','cancelled','interrupted'].includes(job.status)&&job.result?.items?.some(i=>i.status==='ready');if(!ready||job.snapshot?.project_schema!==core.SCHEMA||job.project_id!==p.msw?.project_id)throw Error('结果尚未完成或不属于当前平级工程');
    if(p.msw.applied_results?.includes(job.id))throw Error('这批结果已经应用；可撤销后重新应用');core.validate(native(job.snapshot));}
  function unchanged(p,s,id){const before=edit.cue(native(s),id),now=edit.cue(p,id);if(!same(before,now)||!same(edit.relation(native(s),id),edit.relation(p,id)))throw Error('字幕内容、时间、轨道或对应关系已变化；请重新处理，未覆盖当前修改');return now;}
  function mark(p,job){p.msw.applied_results||=[];p.msw.applied_results.push(job.id);}
  function applyTranslation(p,job,makeId){checkBase(p,job);const s=job.snapshot;writable(p,s.subtitle_track_id);const n=copy(p),ids=[],skipped=new Set(job.result?.skipped_ids||[]);
    const output=job.result?.translations;if(!Array.isArray(output))throw Error('翻译结果格式无效');const seen=new Set();
    for(const row of output){if(seen.has(row.id)||typeof row.text!=='string'||!row.text.trim()||!s.entries.some(e=>e.source.id===row.id))throw Error('翻译结果包含无效或重复的来源');seen.add(row.id);}
    for(const entry of s.entries){const c=unchanged(p,s,entry.source.id),peer=edit.partner(p,c.id);if(peer)unchanged(p,s,peer.id);if(skipped.has(c.id))continue;
      const result=output.find(r=>r.id===c.id);if(!result)throw Error('翻译结果缺少所选字幕，未应用不完整结果');
      let content;
      if(peer){const dest=edit.cue(n,peer.id);content=dest.content;content.text=result.text;delete content.items;content._dirty=true;ids.push(dest.id);}
      else {const id=makeId('cue');content={start:c.content.start,end:c.content.end,text:result.text};n.subtitles.cues.push({id,track_id:s.subtitle_track_id,content});
        n.subtitles.bindings.push({id:makeId('binding'),source_id:c.id,target_id:id,start_offset_ms:0,end_offset_ms:0});ids.push(id);}
      const head=edit.cue(p,c.content.color_ref?.cue_id);
      speaker.inherit(c.content,content,head?.content);
    }
    mark(n,job);core.validate(n);return {project:n,ids};
  }
  function applyAsr(p,job,media,makeId){checkBase(p,job);const s=job.snapshot;writable(p,s.subtitle_track_id);
    if(s.mode==='clips') {
      const clip=p.msw.audio_clips?.find(c=>c.id===s.source.clip.id),asset=p.msw.assets?.find(a=>a.id===s.source.id);
      if(!clip||asset?.sha256!==s.source.revision||Object.keys(s.source.clip).some(k=>clip[k]!==s.source.clip[k]))throw Error('音频贴片已移动、裁剪、替换或删除');
    } else if(media?.id!==s.source.id||media.revision!==s.source.revision||media.audio_index!==s.source.audio_index)throw Error('媒体或音轨已变化，请重新识别');
    const before=affected(native(s),s.subtitle_track_id,s.range),now=affected(p,s.subtitle_track_id,s.range);
    if(!same(before,now))throw Error('识别范围内字幕已变化，未覆盖当前修改');for(const c of now)unchanged(p,s,c.id);
    if(now.some(c=>edit.partner(p,c.id)))throw Error('目标字幕已有对应关系，请改用新轨道');
    let n=now.length?edit.remove(p,now.map(c=>c.id)):copy(p);const result=job.result?.segments;if(!Array.isArray(result)||!result.length)throw Error('此范围未识别到字幕，原字幕已保留');
    const ids=result.map(()=>makeId('cue'));
    result.forEach((raw,i)=>{const content=copy(raw);delete content.id;
      if(content.start<s.range.start||content.end>s.range.end)throw Error('识别结果超出请求范围');
      for(const ref of ['color_ref','sticker_ref'])if(content[ref]){const head=content[ref].headIdx;if(!Number.isInteger(head)||!ids[head])throw Error('识别结果标记引用无效');content[ref]={...content[ref],cue_id:ids[head]};delete content[ref].headIdx;}
      edit.frame(n,content);n.subtitles.cues.push({id:ids[i],track_id:s.subtitle_track_id,content});});
    mark(n,job);core.validate(n);return {project:n,ids};
  }
  function applyTts(p,job){checkBase(p,job);const n=copy(p),items=job.result?.items||[],assets=items.filter(i=>i.status==='ready').map(i=>i.asset);
    if(!assets.length)throw Error('没有可用配音结果');
    for(const asset of assets){const source=asset?.source_ref,entry=job.snapshot.entries.find(e=>e.key===source?.key);if(!entry||source.subtitle_cue_id!==entry.id)throw Error('配音结果来源不一致');unchanged(p,job.snapshot,entry.id);
      if(global.MSWProject&&!global.MSWProject.validAsset(asset))throw Error('配音素材格式无效');}
    n.msw.assets||=[];for(const asset of assets)if(!n.msw.assets.some(a=>a.id===asset.id))n.msw.assets.push(copy(asset));mark(n,job);return {project:n,ids:[]};
  }
  const api={capture,translation,tts,asr,applyTranslation,applyAsr,applyTts,same};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MSWFlatProcessing=api;
})(typeof globalThis!=='undefined'?globalThis:this);
