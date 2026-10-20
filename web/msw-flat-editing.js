// Atomic v4 editing transactions. Legacy arrays are a disposable display view.
(function(global) {
  'use strict';
  const core=typeof module!=='undefined'&&module.exports?require('./msw-flat-subtitles.js'):global.MSWFlatSubtitles;
  const layers=typeof module!=='undefined'&&module.exports?require('./msw-subtitle-layers.js'):global.MSWSubtitleLayers;
  const copy=value=>JSON.parse(JSON.stringify(value));
  const cueStyle=typeof module!=='undefined'&&module.exports?require('./msw-cue-style.js'):global.MSWCueStyle;
  const motion=typeof module!=='undefined'&&module.exports?require('./msw-subtitle-animation.js'):global.MSWSubtitleAnimation;
  const fail=message=>{throw Error(message);};
  const body=p=>p.subtitles;
  const cue=(p,id)=>body(p).cues.find(c=>c.id===id);
  const track=(p,id)=>body(p).tracks.find(t=>t.id===id);
  const relation=(p,id)=>body(p).bindings.find(b=>b.source_id===id||b.target_id===id);
  const partner=(p,id)=>{const b=relation(p,id);return b?cue(p,b.source_id===id?b.target_id:b.source_id):null;};
  function editable(p,ids) {
    for(const id of ids) {const c=cue(p,id);if(!c)fail('字幕已不存在');if(track(p,c.track_id).locked)fail('操作包含锁定轨道，请先解锁');}
  }
  function transaction(p,change) {core.validate(p);const next=copy(p);change(next);core.validate(next);return next;}
  function frame(p,c) {
    for(const value of [c,...(c.items||[])]) {
      if(p.timebase?.unit==='frames') {
        value.start_frame=Math.round(value.start*p.timebase.fps/1000);
        value.end_frame=Math.max(value.start_frame+1,Math.round(value.end*p.timebase.fps/1000));
      } else {delete value.start_frame;delete value.end_frame;}
    }
  }
  function refreshOffsets(p) {for(const b of body(p).bindings)for(const edge of ['start','end'])b[edge+'_offset_ms']=cue(p,b.target_id).content[edge]-cue(p,b.source_id).content[edge];}
  function marker(p,c,field) {const ref=c.content[field+'_ref'];return c.content[field]||cue(p,ref?.cue_id)?.content[field]||null;}
  function detachReferences(p,removed) {
    for(const c of body(p).cues)for(const field of ['color','sticker'])if(removed.has(c.content[field+'_ref']?.cue_id)) {
      c.content[field]=copy(marker(p,c,field));delete c.content[field+'_ref'];
    }
  }
  function updateText(p,id,text) {return transaction(p,next=>{editable(next,[id]);const c=cue(next,id).content;if(c.text===text)return;c.text=text;c.items=[];c._dirty=true;});}
  function updateAnimation(p,changes,{reset=null}={}) {
    if(reset!==null&&reset!=='all'&&!motion.names.includes(reset))fail('字幕动画恢复对象无效');
    return transaction(p,next=>{
      editable(next,changes.map(c=>c.id));
      for(const change of changes){
        const c=cue(next,change.id).content;
        if(reset==='all'){delete c.subtitle_animation;continue;}
        const effects={...c.subtitle_animation?.effects};
        if(reset)delete effects[reset];
        else{
          if(!motion.valid(change.animation))fail('字幕动画覆盖包含无效参数');
          Object.assign(effects,change.animation.effects);
        }
        const mode=change.animation?.mode??c.subtitle_animation?.mode;
        if(Object.keys(effects).length||mode)c.subtitle_animation={schema:motion.schema,...(mode?{mode}:{}),effects};else delete c.subtitle_animation;
      }
    });
  }
  function updateAppearance(p,ids,patch,{reset=[] ,replace=false,presetId}={}) {
    if(!cueStyle.valid(patch)||!Array.isArray(reset)||reset.some(k=>!cueStyle.fields.includes(k)))fail('字幕外观覆盖包含无效参数');
    if(presetId!==undefined&&(typeof presetId!=='string'||!presetId.trim()||presetId.length>160))fail('字幕外观预设标识无效');
    return transaction(p,next=>{
      editable(next,ids);
      for(const id of new Set(ids)) {
        const content=cue(next,id).content,style=replace?{}:{...content.subtitle_style};
        for(const k of reset)delete style[k];
        Object.assign(style,patch);
        if(Object.keys(style).length)content.subtitle_style=style;else delete content.subtitle_style;
        if(presetId!==undefined)content.subtitle_style_preset=presetId;
        else if(replace&&!Object.keys(patch).length)delete content.subtitle_style_preset;
      }
    });
  }
  function updateRangesInternal(p,changes,{linked=true}={},inPlace=false) {
    const apply=next=>{
      const planned=new Map(changes.map(c=>[c.id,c]));
      for(const change of changes) {
        const source=cue(next,change.id),other=partner(next,change.id);
        if(!source)fail('字幕已不存在');
        if(linked&&other&&!planned.has(other.id))planned.set(other.id,{id:other.id,
          start:other.content.start+change.start-source.content.start,end:other.content.end+change.end-source.content.end});
      }
      editable(next,[...planned.keys()]);
      for(const change of planned.values()) {
        const c=cue(next,change.id).content,delta=change.start-c.start,moving=change.end-c.end===delta;
        c.items=(c.items||[]).map(i=>({...i,start:Math.max(change.start,i.start+(moving?delta:0)),end:Math.min(change.end,i.end+(moving?delta:0))})).filter(i=>i.end>=i.start);
        for(const f of ['color','sticker'])if(c[f]){c[f].start=change.start;c[f].end=change.end;}
        c.start=change.start;c.end=change.end;c._dirty=true;frame(next,c);
      }
      refreshOffsets(next);
    };
    return inPlace?(apply(p),p):transaction(p,apply);
  }
  function updateRanges(p,changes,options) {return updateRangesInternal(p,changes,options);}
  function setDisabled(p,ids,disabled) {return transaction(p,n=>{editable(n,ids);for(const id of ids)cue(n,id).content.disabled=disabled;});}
  function setColor(p,ids,name) {return transaction(p,n=>{
    editable(n,ids);detachReferences(n,new Set(ids));
    for(const id of ids){const c=cue(n,id).content;delete c.color;delete c.color_ref;if(name)c.color={name,start:c.start,end:c.end};}
  });}
  function remove(p,ids) {return transaction(p,n=>{
    const removed=new Set(ids),links=body(n).bindings.filter(b=>removed.has(b.source_id)||removed.has(b.target_id));
    editable(n,[...ids,...links.flatMap(b=>[b.source_id,b.target_id])]);detachReferences(n,removed);
    body(n).cues=body(n).cues.filter(c=>!removed.has(c.id));body(n).bindings=body(n).bindings.filter(b=>!links.includes(b));
  });}
  function updateTrack(p,id,patch) {return transaction(p,n=>{const t=track(n,id);if(!t)fail('轨道已不存在');
    if(t.locked&&Object.keys(patch).some(k=>!['name','purpose','enabled','collapsed','locked'].includes(k)))fail('轨道已锁定');Object.assign(t,copy(patch));});}
  function deleteTrack(p,id) {return transaction(p,n=>{const t=track(n,id);if(!t||t.locked||body(n).tracks.some(t=>t.secondary_for===id&&t.locked))fail('轨道不存在或已锁定');if(body(n).tracks.length===1)fail('至少保留一条轨道');if(body(n).cues.some(c=>c.track_id===id))fail('请先移动或删除轨道中的字幕');body(n).tracks=body(n).tracks.filter(t=>t.id!==id);if(body(n).next_track_number)core.normalizeGroups(n);});}
  function reorder(p,id,delta) {return transaction(p,n=>{const tracks=body(n).tracks,i=tracks.findIndex(t=>t.id===id),j=i+delta;if(i<0||j<0||j>=tracks.length)fail('已到达轨道边界');[tracks[i],tracks[j]]=[tracks[j],tracks[i]];});}
  function addCue(p,trackId,id,start,end,text='') {return transaction(p,n=>{const t=track(n,trackId);if(!t||t.locked)fail('目标轨道不存在或已锁定');const content={start,end,text,items:[],_dirty:true};frame(n,content);body(n).cues.push({id,track_id:trackId,content});});}
  function offsets(text) {
    if(typeof Intl.Segmenter==='function')return [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(s=>s.index).concat(text.length);
    let i=0;return [0,...Array.from(text).map(s=>(i+=s.length))];
  }
  function nearestOffset(text,value) {return offsets(text).reduce((a,b)=>Math.abs(b-value)<Math.abs(a-value)?b:a,0);}
  function offsetAt(c,time) {
    const text=c.text,items=c.items||[];let at=0;
    for(const item of items){const start=text.indexOf(item.text,at);if(start<0)continue;
      if(time<=item.end)return nearestOffset(text,time<=item.start?start:start+item.text.length*(time-item.start)/Math.max(1,item.end-item.start));at=start+item.text.length;}
    return nearestOffset(text,text.length*(time-c.start)/Math.max(1,c.end-c.start));
  }
  function timeAt(c,offset) {
    let cursor=0;for(const item of c.items||[]){const start=c.text.indexOf(item.text,cursor);if(start<0)continue;
      const end=start+item.text.length;if(offset<=end)return Math.round(offset<=start?item.start:item.start+(item.end-item.start)*(offset-start)/Math.max(1,item.text.length));cursor=end;}
    return Math.round(c.start+(c.end-c.start)*offset/Math.max(1,c.text.length));
  }
  function split(p,id,time,{independent=false,positions={},keepText=false,makeId}={}) {
    if(typeof makeId!=='function')fail('缺少新字幕身份生成器');
    const ids=[];const result=transaction(p,n=>{
      const source=cue(n,id),other=partner(n,id),link=relation(n,id);if(!source)fail('字幕已不存在');
      const members=independent||!other?[source]:[source,other];editable(n,other?[id,other.id]:[id]);
      const removed=new Set(members.map(c=>c.id));detachReferences(n,removed);
      const halves=new Map();
      for(const c of members) {
        const content=c.content,cut=Math.round(time);
        if(cut<=content.start||cut>=content.end)fail('切分时间必须在每条参与字幕的内部');
        const offset=nearestOffset(content.text,positions[c.id]??offsetAt(content,cut));
        const texts=keepText?[content.text,content.text]:[content.text.slice(0,offset),content.text.slice(offset)];
        const pair=texts.map((text,i)=>{const out=copy(c);out.id=makeId('cue');out.content={...copy(content),text,start:i?cut:content.start,end:i?content.end:cut,items:[],_dirty:true};
          let cursor=0;
          for(const item of content.items||[]) {
            const start=content.text.indexOf(item.text,cursor),end=start<0?-1:start+item.text.length;if(start>=0)cursor=end;
            const part=copy(item);
            if(!keepText&&start>=0){part.text=i?item.text.slice(Math.max(0,offset-start)):item.text.slice(0,Math.max(0,offset-start));if(!part.text)continue;}
            part.start=Math.max(out.content.start,item.start);part.end=Math.min(out.content.end,item.end);
            if(part.end>=part.start)out.content.items.push(part);
          }
          for(const field of ['color','sticker'])if(marker(n,c,field)){out.content[field]={...copy(marker(n,c,field)),start:out.content.start,end:out.content.end};delete out.content[field+'_ref'];}
          frame(n,out.content);return out;});halves.set(c.id,pair);ids.push(...pair.map(c=>c.id));
      }
      body(n).cues=body(n).cues.filter(c=>!removed.has(c.id)).concat([...halves.values()].flat());
      if(link){body(n).bindings=body(n).bindings.filter(b=>b!==link);if(!independent)for(let i=0;i<2;i++)body(n).bindings.push({id:makeId('binding'),source_id:halves.get(link.source_id)[i].id,target_id:halves.get(link.target_id)[i].id,start_offset_ms:0,end_offset_ms:0});}
      refreshOffsets(n);
    });return {project:result,ids};
  }
  function mergeInternal(p,ids,{mode='union',makeId,joinText}={},inPlace=false) {
    const selected=[...new Set(ids)],source=selected.map(id=>cue(p,id));
    if(source.length<2||source.some(c=>!c)||new Set(source.map(c=>c.track_id)).size!==1)fail('请选择至少两个同轨道字幕');
    const other=source.map(c=>partner(p,c.id)).filter(Boolean),otherTracks=new Set(other.map(c=>c.track_id));
    if(otherTracks.size>1)fail('对应字幕位于不同轨道，请分别合并');
    const directions=new Set(source.filter(c=>relation(p,c.id)).map(c=>relation(p,c.id).source_id===c.id));
    if(directions.size>1)fail('对应关系的来源方向不一致，请先统一对应关系再合并');
    const groups=[source,...(other.length?[other]:[])],newIds=[],conflicts=[];
    const reference=source.map(c=>relation(p,c.id)).find(Boolean);
    const apply=n=>{
      const allIds=groups.flat().map(c=>c.id),removed=new Set(allIds);editable(n,allIds);detachReferences(n,removed);
      const merges=groups.map(group=>{
        const members=group.map(c=>cue(n,c.id)),rows=members.map(c=>({...copy(c.content),id:c.id}));
        for(const row of rows)for(const field of ['color','sticker'])if(marker(n,cue(n,row.id),field)){row[field]=copy(marker(n,cue(n,row.id),field));delete row[field+'_ref'];}
        if(rows.length===1)return copy(members[0]);
        const virtual=layers.migrate({segments:rows}),plan=layers.planMerge(virtual,{role:'main',track_id:null},rows.map(c=>c.id),{mode,makeId:()=>makeId('cue'),joinText:cues=>joinText?joinText(cues,members[0].track_id):cues.map(c=>c.text).join(cues.every(c=>/[\u3400-\u9fff]/.test(c.text))?'':' ')});
        const merged=plan.changes[0].merged;conflicts.push(...plan.conflicts);
        const earliest=members.slice().sort((a,b)=>a.content.start-b.content.start||a.content.end-b.content.end||a.id.localeCompare(b.id))[0];
        if(earliest.content.subtitle_position)merged.subtitle_position=copy(earliest.content.subtitle_position);
        else delete merged.subtitle_position;
        if(earliest.content.subtitle_style)merged.subtitle_style=copy(earliest.content.subtitle_style);
        else delete merged.subtitle_style;
        if(earliest.content.subtitle_style_preset)merged.subtitle_style_preset=earliest.content.subtitle_style_preset;
        else delete merged.subtitle_style_preset;
        if(earliest.content.subtitle_animation)merged.subtitle_animation=copy(earliest.content.subtitle_animation);
        else delete merged.subtitle_animation;
        const out={...copy(members[0]),id:merged.id,content:merged};
        if(members.some(c=>Object.hasOwn(c,'hidden')))out.hidden=mode==='common'?members.every(c=>c.hidden):members.some(c=>c.hidden);
        delete out.content.id;frame(n,out.content);return out;
      });
      body(n).bindings=body(n).bindings.filter(b=>!removed.has(b.source_id)&&!removed.has(b.target_id));
      body(n).cues=body(n).cues.filter(c=>!removed.has(c.id)).concat(merges);newIds.push(...merges.map(c=>c.id));
      if(merges.length===2){const reverse=other.some(c=>c.id===reference.source_id);
        body(n).bindings.push({id:makeId('binding'),source_id:merges[reverse?1:0].id,target_id:merges[reverse?0:1].id,start_offset_ms:0,end_offset_ms:0});}
      // Batch groups are disjoint; refresh their offsets once after the batch.
      if(!inPlace)refreshOffsets(n);
    };
    const result=inPlace?(apply(p),p):transaction(p,apply);
    return {project:result,ids:newIds,conflicts:[...new Set(conflicts)]};
  }
  function merge(p,ids,options) {return mergeInternal(p,ids,options);}

  // Build an entire batch on a disposable copy. No caller-visible edits or IDs
  // are applied until all linked ranges and merged groups pass validation.
  function batchMerge(p,trackId,selectedIds,options={}) {
    core.validate(p);
    const owner=track(p,trackId),utils=options.utils||global.AsrEditorUtils;
    if(!owner)fail('请选择作用轨道');
    if(owner.locked)fail('作用轨道已锁定，请先解锁');
    if(!owner.enabled)fail('作用轨道已禁用，请先启用');
    if(!utils?.planAutoMerge||!utils?.countSubtitleUnits)fail('批量处理工具未加载');
    const rows=body(p).cues.filter(c=>c.track_id===trackId).sort((a,b)=>a.content.start-b.content.start||a.id.localeCompare(b.id));
    const wanted=selectedIds==null?new Set(rows.map(c=>c.id)):new Set(selectedIds);
    const active=c=>c&&!c.hidden&&!c.content.disabled&&track(p,c.track_id).enabled;
    const eligible=rows.map(c=>wanted.has(c.id)&&active(c)&&(!partner(p,c.id)||active(partner(p,c.id))));
    const skipped=rows.filter((c,i)=>wanted.has(c.id)&&!eligible[i]).length;
    const planned=utils.planAutoMerge(rows.map(c=>c.content),{...options,
      canPair:(a,b)=>eligible[a]&&eligible[b],
      isShort:(c,i)=>eligible[i]&&utils.countSubtitleUnits(c.text,owner.split_mode)<(options.shortCount||3),
    });
    const snaps=options.snapGaps===false?[]:planned.snaps,changes=new Map();
    for(const s of snaps) {
      const c=rows[s.index];let change=changes.get(c.id);
      if(!change){change={id:c.id,start:c.content.start,end:c.content.end};changes.set(c.id,change);}
      change[s.edge]=s.time;
    }
    // Adjacent short runs can share a long neighbour; combine their plans so
    // each original cue is merged once, rather than reusing a removed ID.
    const groups=[];
    for(const group of planned.groups) {
      const last=groups.at(-1);
      if(last&&group[0]<=last.at(-1))groups[groups.length-1]=[...new Set([...last,...group])].sort((a,b)=>a-b);
      else groups.push([...group]);
    }
    let next=copy(p);
    if(changes.size)updateRangesInternal(next,[...changes.values()],{},true);
    const used=new Set([...body(p).cues,...body(p).bindings].map(c=>c.id));let serial=0;
    const makeId=options.makeId||((kind)=>{let id;do{id=`batch-preview-${kind}-${++serial}`;}while(used.has(id));used.add(id);return id;});
    const resultIds=new Set(changes.keys()),affected=new Set(changes.keys()),linked=new Set(),conflicts=new Set(),mergedGroups=[];
    for(const id of changes.keys()){const other=partner(p,id);if(other)linked.add(other.id);}
    for(const group of groups) {
      const ids=group.map(i=>rows[i].id),members=ids.map(id=>cue(next,id));
      for(const c of members){affected.add(c.id);const other=partner(next,c.id);if(other)linked.add(other.id);}
      const beforeIds=new Set(body(next).cues.map(c=>c.id)),right=new Set(next.subtitle_view?.secondary_cue_ids||body(next).bindings.map(b=>b.target_id));
      const displayRight=right.has(members[0].id);
      const result=mergeInternal(next,ids,{mode:options.mode,makeId,joinText:options.joinText},true);
      next=result.project;const remaining=new Set(body(next).cues.map(c=>c.id));
      const removed=[...beforeIds].filter(id=>!remaining.has(id));
      for(const id of removed){right.delete(id);resultIds.delete(id);}
      for(const id of result.ids){
        const c=cue(next,id),isRight=c.track_id===trackId?displayRight:!displayRight;
        if(isRight)right.add(id);else right.delete(id);
        if(c.track_id===trackId)resultIds.add(id);
      }
      next.subtitle_view={...next.subtitle_view,secondary_cue_ids:[...right]};
      result.conflicts.forEach(c=>conflicts.add(c));mergedGroups.push({sourceIds:ids,removedIds:removed,resultIds:result.ids});
    }
    if(groups.length)refreshOffsets(next);
    core.validate(next);
    return {project:next,ids:[...resultIds],groups:mergedGroups,conflicts:[...conflicts],
      stats:{scope:rows.filter(c=>wanted.has(c.id)).length,skipped,snaps:snaps.length,groups:groups.length,
        merged:groups.reduce((n,g)=>n+g.length,0),affected:affected.size,linked:linked.size}};
  }
  function editorView(p) {
    core.validate(p);const view=copy(p);delete view.subtitles;view.schema='msw.project.v3';
    view.segments=body(p).cues.map(c=>{const s={...copy(c.content),id:c.id};for(const f of ['color','sticker']){const value=marker(p,c,f);if(value)s[f]=copy(value);delete s[f+'_ref'];}return s;}).sort((a,b)=>a.start-b.start);
    view.multi_subtitle={schema:'moy.asr.multi_subtitle.v1',enabled:false,tracks:[],bindings:[]};
    view.subtitle_layers={schema:'msw.subtitle_layers.v1',allow_overlap:true,legacy_overlay:{visible:false,cue_ids:body(p).cues.filter(c=>c.hidden).map(c=>c.id)},presentation:{mode:'manual',gap:0}};
    view.subtitle_tracks={schema:'msw.subtitle_tracks.v2',presentation:'legacy',tracks:body(p).tracks.map(t=>{
      const style=copy(t.style);delete style.slot;delete style.base;
      return {id:t.id,name:t.name,kind:'dialogue',purpose:t.purpose,layout:t.layout,style_base:t.style.base,origin:'main',enabled:t.enabled,locked:t.locked,collapsed:t.collapsed,style,...(t.position?{position:copy(t.position)}:{})};
    }),assignments:body(p).cues.map(c=>({role:'main',track_id:null,cue_id:c.id,subtitle_track_id:c.track_id}))};
    return view;
  }
  class History {
    constructor(project){core.validate(project);this.project=copy(project);this.undoStack=[];this.redoStack=[];}
    commit(project,label,selection=[]){core.validate(project);if(JSON.stringify(project)===JSON.stringify(this.project))return false;this.undoStack.push({project:this.project,label,selection:[...selection]});this.redoStack=[];this.project=copy(project);return true;}
    step(direction,selection=[]){const from=direction==='undo'?this.undoStack:this.redoStack,to=direction==='undo'?this.redoStack:this.undoStack;if(!from.length)return null;
      const entry=from.pop();to.push({project:this.project,label:entry.label,selection:[...selection]});this.project=entry.project;return entry.selection;}
  }
  const api={transaction,frame,cue,track,relation,partner,editable,updateText,updateAppearance,updateAnimation,updateRanges,setDisabled,setColor,remove,updateTrack,deleteTrack,reorder,addCue,offsetAt,timeAt,nearestOffset,split,merge,batchMerge,editorView,History};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MSWFlatEditing=api;
})(typeof globalThis!=='undefined'?globalThis:this);
