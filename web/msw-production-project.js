// Reversible operation view for the existing MSWE components. Physical track
// ownership and global cue IDs are independent of the two list display columns.
(function(global) {
  'use strict';
  const core=global.MSWFlatSubtitles||(typeof require==='function'?require('./msw-flat-subtitles.js'):null);
  const legacy=global.MSWSubtitleTracks||(typeof require==='function'?require('./msw-subtitle-tracks.js'):null);
  const layers=global.MSWSubtitleLayers||(typeof require==='function'?require('./msw-subtitle-layers.js'):null);
  const clone=v=>JSON.parse(JSON.stringify(v));
  const EXT='flat-list-secondary';
  const structural=['segments','multi_subtitle','subtitle_tracks','subtitle_layers','overlay_track'];
  const isView=p=>p?.subtitle_tracks?.flat_context?.schema==='msw.flat-operation-view.v1';
  const extras=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([k])=>!keys.includes(k)));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function fromProject(input,{mainSplitModeOverride=null}={}) {
    const p=core.normalizeGroups(core.migrate(input),{infer:true}),m=p.subtitles,view=clone(p);delete view.subtitles;view.schema=legacy.SCHEMA;
    const context={schema:'msw.flat-operation-view.v1',model:extras(m,['tracks','cues','bindings']),
      tracks:{},cues:{},bindings:{},bindingSources:{},markers:{}};
    const right=new Set(m.bindings.map(b=>b.target_id)),left=new Set(m.bindings.map(b=>b.source_id));
    const displayedRight=new Set(p.subtitle_view?.secondary_cue_ids||[]);
    for(const b of m.bindings) {
      if(displayedRight.has(b.source_id)&&!displayedRight.has(b.target_id)) {
        right.delete(b.target_id);right.add(b.source_id);left.delete(b.source_id);left.add(b.target_id);
      }
      context.bindingSources[b.source_id]=true;context.bindingSources[b.target_id]=false;
    }
    const aliases=new Map((m.migration?.identities||[]).map(a=>[a.id,a]));
    const trackMap=new Map(m.tracks.map(t=>[t.id,t]));
    for(const c of m.cues)if(!left.has(c.id)&&!right.has(c.id)
      && (Array.isArray(p.subtitle_view?.secondary_cue_ids)?p.subtitle_view.secondary_cue_ids.includes(c.id)
        :p.subtitle_view?.right_track_id===c.track_id||aliases.get(c.id)?.role==='extension'||trackMap.get(c.track_id).style.slot==='secondary'))right.add(c.id);
    view.segments=[];
    const secondary=[];
    for(const c of m.cues) {
      context.cues[c.id]=extras(c,['id','track_id','content']);
      (right.has(c.id)?secondary:view.segments).push({id:c.id,...clone(c.content)});
    }
    for(const rows of [view.segments,secondary])rows.sort((a,b)=>a.start-b.start||a.end-b.end);
    const byId=new Map(m.cues.map(c=>[c.id,c]));
    for(const rows of [view.segments,secondary])for(const c of rows)for(const field of ['color','sticker']) {
      const ref=c[field+'_ref'];if(!ref)continue;
      const head=rows.findIndex(a=>a.id===ref.cue_id);
      if(head>=0&&head<rows.indexOf(c)){c[field+'_ref']={...ref,headIdx:head};delete c[field+'_ref'].cue_id;}
      else {
        c[field]=clone(byId.get(ref.cue_id).content[field]);delete c[field+'_ref'];
        (context.markers[c.id]||={})[field]={ref:clone(ref),value:clone(c[field])};
      }
    }
    const oldMulti=m.migration?.structure?.multi_subtitle||{};
    // Upgrade old column preferences once. Explicit per-track choices (including
    // automatic detection) always win, regardless of the current display side.
    for(const t of m.tracks) {
      if(p.subtitle_view?.track_split_modes_migrated===true)continue;
      const own=m.cues.filter(c=>c.track_id===t.id),secondary=own.length?right.has(own[0].id):t.style.slot==='secondary';
      if(!secondary&&['word','continuous'].includes(mainSplitModeOverride)&&(input?.schema!==core.SCHEMA||t.split_mode===undefined))t.split_mode=mainSplitModeOverride;
      if(t.split_mode!==undefined)continue;
      const mode=secondary?(p.subtitle_view?.secondary_split_mode||oldMulti.tracks?.[0]?.split_mode)
        :(p.subtitle_view?.main_split_mode||oldMulti.main_split_mode);
      if(['word','continuous'].includes(mode))t.split_mode=mode;
    }
    view.multi_subtitle={...clone(extras(oldMulti,['tracks','bindings'])),schema:'moy.asr.multi_subtitle.v1',
      enabled:true,
      display_mode:p.subtitle_view?.display_mode||oldMulti.display_mode||'both',
      main_split_mode:p.subtitle_view?.main_split_mode||oldMulti.main_split_mode,
      tracks:[{id:EXT,role:'extension',name:'绑定字幕',language:'',split_mode:p.subtitle_view?.secondary_split_mode||oldMulti.tracks?.[0]?.split_mode,segments:secondary}],bindings:[]};
    if(view.multi_subtitle.main_split_mode===undefined)delete view.multi_subtitle.main_split_mode;
    if(view.multi_subtitle.tracks[0].split_mode===undefined)delete view.multi_subtitle.tracks[0].split_mode;
    for(const b of m.bindings) {
      context.bindings[b.id]=extras(b,['source_id','target_id','start_offset_ms','end_offset_ms']);
      const reversed=right.has(b.source_id);
      view.multi_subtitle.bindings.push({id:b.id,track_id:EXT,main_segment_ids:[reversed?b.target_id:b.source_id],extension_segment_ids:[reversed?b.source_id:b.target_id],
        start_offset_ms:(reversed?-1:1)*b.start_offset_ms,end_offset_ms:(reversed?-1:1)*b.end_offset_ms});
    }
    view.subtitle_layers=clone(m.migration?.structure?.subtitle_layers||layers.migrate({segments:[]}).subtitle_layers);
    view.subtitle_layers.legacy_overlay={...view.subtitle_layers.legacy_overlay,visible:false,cue_ids:m.cues.filter(c=>c.hidden&&!right.has(c.id)).map(c=>c.id)};
    view.subtitle_tracks={schema:legacy.TRACK_SCHEMA,presentation:'fixed',tracks:m.tracks.map(t=>{
      context.tracks[t.id]=extras(t,['id','name','purpose','layout','enabled','locked','collapsed','style','position','display_number','secondary_for','split_mode']);
      return {id:t.id,name:t.name,display_number:t.display_number,...(t.secondary_for?{secondary_for:t.secondary_for}:{}),purpose:t.purpose,layout:t.layout,kind:t.style.base,style_base:t.style.base,
        origin:'main',enabled:t.enabled,locked:t.locked,collapsed:t.collapsed,...(t.split_mode?{split_mode:t.split_mode}:{}),
        style:clone(extras(t.style,['slot','base'])),flat_style_slot:t.style.slot,...(t.position?{position:clone(t.position)}:{})};
    }),assignments:m.cues.map(c=>({role:right.has(c.id)?'extension':'main',track_id:right.has(c.id)?EXT:null,cue_id:c.id,subtitle_track_id:c.track_id})),flat_context:context};
    legacy.validate(view);return view;
  }
  function normalizeView(view) {
    if(!isView(view))return view;
    const model=view.subtitle_tracks.flat_context.model;
    const p={subtitles:{...model,tracks:view.subtitle_tracks.tracks,cues:[],bindings:[]}};
    core.normalizeGroups(p);model.next_track_number=p.subtitles.next_track_number;return view;
  }
  // Preview keeps complete overlap components, including bound partners. A
  // neighbouring group can affect lane allocation indirectly, so a plain
  // time crop is not sufficient to preserve the export layout.
  function previewIds(view, range) {
    const rows=[...(view.segments||[]),...(view.multi_subtitle?.tracks||[]).flatMap(t=>t.segments)];
    const parent=new Map(rows.map(c=>[c.id,c.id]));
    const root=id=>{let next=id;while(parent.get(next)!==next)next=parent.get(next);while(id!==next){const old=parent.get(id);parent.set(id,next);id=old;}return next;};
    const join=(a,b)=>{if(parent.has(a)&&parent.has(b))parent.set(root(a),root(b));};
    let last=null,end=-Infinity;
    for(const c of [...rows].sort((a,b)=>a.start-b.start)) {
      if(c.start<end)join(last,c.id);
      if(c.end>end||c.start>=end){last=c.id;end=c.end;}
    }
    for(const b of view.multi_subtitle?.bindings||[])join(b.main_segment_ids[0],b.extension_segment_ids[0]);
    const wanted=new Set(rows.filter(c=>c.start<range.end&&c.end>range.start).map(c=>root(c.id)));
    return new Set(rows.filter(c=>wanted.has(root(c.id))).map(c=>c.id));
  }
  function toProject(view, {previewWindow=null}={}) {
    if(!isView(view))return core.migrate(view);
    if(!previewWindow)legacy.validate(view);
    const selected=previewWindow?previewIds(view,previewWindow):null;
    // Each cue is copied below. Do not first duplicate the same cue/word data
    // (and its operation-view metadata) only to discard those fields here.
    const p=clone(extras(view,structural)),context=view.subtitle_tracks.flat_context;
    p.schema=core.SCHEMA;
    const m={...clone(previewWindow?extras(context.model,['migration']):context.model),schema:core.MODEL_SCHEMA,tracks:[],cues:[],bindings:[]};p.subtitles=m;
    if(previewWindow)m.migration={schema:core.MIGRATION_SCHEMA,identities:[],structure:{segments:[],subtitle_layers:{presentation:clone(view.subtitle_layers?.presentation||{})}}};
    const owners=legacy.ownerMap(view),allIds=new Set();
    for(const t of view.subtitle_tracks.tracks)m.tracks.push({...clone(context.tracks[t.id]||{}),
      id:t.id,name:t.name,...(t.display_number?{display_number:t.display_number}:{}),...(t.secondary_for?{secondary_for:t.secondary_for}:{}),purpose:legacy.purpose(t),layout:legacy.placement(t),enabled:t.enabled,locked:t.locked,collapsed:t.collapsed,
      style:{...clone(t.style),slot:t.flat_style_slot||'main',base:legacy.styleKind(t)},...(t.position?{position:clone(t.position)}:{}),...(t.split_mode?{split_mode:t.split_mode}:{})});
    const sources=[{role:'main',track_id:null,segments:view.segments},...(view.multi_subtitle?.tracks||[]).map(t=>({role:'extension',track_id:t.id,segments:t.segments}))];
    const byId=new Map(sources.flatMap(s=>s.segments).map(c=>[c.id,c]));
    for(const source of sources)for(const value of source.segments) {
      if(selected&&!selected.has(value.id))continue;
      const content=clone(previewWindow?Object.fromEntries(Object.entries(value).filter(([k])=>!k.startsWith('_')&&!['items','start_frame','end_frame','sticker','sticker_ref'].includes(k))):value);delete content.id;
      for(const field of ['color','sticker']) {
        const ref=content[field+'_ref'];
        if(previewWindow) {
          if(ref){const head=source.segments[ref.headIdx];if(head?.[field])content[field]=clone(head[field]);delete content[field+'_ref'];}
          continue;
        }
        if(ref){const head=source.segments[ref.headIdx];if(!head)throw Error('字幕标记引用已失效');content[field+'_ref']={...ref,cue_id:head.id};delete content[field+'_ref'].headIdx;}
        else {const original=context.markers[value.id]?.[field];if(original&&same(content[field],original.value)) {
          const head=byId.get(original.ref.cue_id);
          if(head&&same(head[field],original.value)){content[field+'_ref']=clone(original.ref);delete content[field];}
        }}
        if(content[field]==null)delete content[field];if(content[field+'_ref']==null)delete content[field+'_ref'];
      }
      if(content.items==null)delete content.items;
      const extra=clone(context.cues[value.id]||{});
      const c={...extra,id:value.id,track_id:owners.get(legacy.key({...source,cue_id:value.id})),content};
      if(source.role==='main'&&view.subtitle_layers.legacy_overlay.cue_ids.includes(c.id))c.hidden=!view.subtitle_layers.legacy_overlay.visible;
      m.cues.push(c);allIds.add(c.id);
    }
    for(const b of view.multi_subtitle?.bindings||[]) {
      const a=b.main_segment_ids[0],z=b.extension_segment_ids[0];
      if(selected&&(!selected.has(a)||!selected.has(z)))continue;
      const reversed=context.bindingSources?.[a]===false||context.bindingSources?.[z]===true;
      m.bindings.push({...clone(context.bindings[b.id]||{}),id:b.id,source_id:reversed?z:a,target_id:reversed?a:z,
        start_offset_ms:(reversed?-1:1)*(b.start_offset_ms||0),end_offset_ms:(reversed?-1:1)*(b.end_offset_ms||0)});
    }
    // Display preference is not a track relationship.
    p.subtitle_view={...p.subtitle_view,display_mode:view.multi_subtitle?.display_mode||'both',secondary_cue_ids:sources.filter(s=>s.role==='extension').flatMap(s=>s.segments.filter(c=>!selected||selected.has(c.id)).map(c=>c.id)),
      track_split_modes_migrated:true};
    delete p.subtitle_view.main_split_mode;delete p.subtitle_view.secondary_split_mode;
    core.normalizeGroups(p);core.validate(p);return p;
  }
  function translation(view,selection,destination='',outputMode='secondary') {
    const p=toProject(view);
    return translationPlan(p,translationIds(view,selection,p),destination,outputMode);
  }
  function translationPlan(p,ids,destination,outputMode) {
    const F=global.MSWFlatProcessing,E=global.MSWFlatEditing;
    if(!ids.length)throw Error('请先选择要翻译的字幕');
    const peers=[...new Set(ids.map(id=>E.partner(p,id)?.track_id).filter(Boolean))];
    if(!destination&&peers.length>1)throw Error('所选字幕绑定到不同轨道，请分批翻译或选择目标轨道');
    const sourceTracks=[...new Set(ids.map(id=>E.cue(p,id).track_id))];
    const grouped=sourceTracks.length===1?p.subtitles.tracks.find(t=>t.secondary_for===sourceTracks[0]):null;
    let target=destination||peers[0]||grouped?.id,created;
    if(!target||target==='new') {
      created={id:global.MSWProject.id('subtitle-track'),name:'译字幕',purpose:'translation',layout:'auto',enabled:true,locked:false,collapsed:false,
        style:{mode:'inherit',slot:'secondary',base:'dialogue'}};
      if(sourceTracks.length===1&&!p.subtitles.tracks.find(t=>t.id===sourceTracks[0]).secondary_for&&!grouped)created.secondary_for=sourceTracks[0];
      p=core.addTrack(p,created);target=created.id;created=clone(p.subtitles.tracks.find(t=>t.id===target));
    }
    const snap=F.translation(p,ids,target);
    return {...snap,output_mode:outputMode,...(created?{created_subtitle_track:created}:{})};
  }
  function trackSelection(view,trackId) {
    const p=toProject(view),ids=new Set(p.subtitles.cues.filter(c=>c.track_id===trackId).map(c=>c.id));
    return {mainIds:(view.segments||[]).filter(c=>ids.has(c.id)).map(c=>c.id),
      extensionIds:(view.multi_subtitle?.tracks||[]).flatMap(t=>t.segments||[]).filter(c=>ids.has(c.id)).map(c=>c.id),
      hasSelection:true,trackId:null};
  }
  function translationIds(view,selection,project=null) {
    const ids=new Set([...(selection.mainIds||[]),...(selection.extensionIds||[])]);
    // A selected pair has one source, regardless of the list's left/right layout.
    for(const b of (project||toProject(view)).subtitles.bindings)if(ids.has(b.source_id))ids.delete(b.target_id);
    return [...ids];
  }
  function translationScope(view,selection,destination='') {
    const p=toProject(view),ids=translationIds(view,selection,p),byId=new Map(p.subtitles.cues.map(c=>[c.id,c]));
    const selectedCount=new Set([...(selection.mainIds||[]),...(selection.extensionIds||[])]).size;
    const sourceTracks=p.subtitles.tracks.map(t=>({id:t.id,name:t.name,count:ids.filter(id=>byId.get(id)?.track_id===t.id).length})).filter(t=>t.count);
    const report={sourceTracks,count:ids.length,pairedCount:selectedCount-ids.length,target:null,issue:''};
    try {
      const snapshot=translationPlan(p,ids,destination,'secondary'),target=snapshot.flat_model.tracks.find(t=>t.id===snapshot.subtitle_track_id);
      report.target={id:target.id,name:target.name,created:Boolean(snapshot.created_subtitle_track),count:snapshot.entries.length};
    } catch(error){report.issue=error.message;}
    return report;
  }
  function place(view,rows,bindings,anchor,ownerId) {
    const E=global.MSWFlatEditing,id=global.MSWProject.id;let p=toProject(view);
    if(!rows.length)return {project:clone(view),ids:[]};
    const owner=E.track(p,ownerId);if(!owner||owner.locked)throw Error('请选择未锁定的字幕轨道');
    const primary=rows[0].track_id,mapping=new Map([[primary,ownerId]]),occupied=new Set([ownerId]);
    for(const r of rows)if(!mapping.has(r.track_id)) {
      let target=E.track(p,r.track_id);
      if(!target||occupied.has(target.id)) {
        target={...clone(owner),id:id('subtitle-track'),name:owner.name+' · 绑定字幕',locked:false,collapsed:false,style:{mode:'inherit',slot:'secondary',base:owner.style.base}};
        p=core.addTrack(p,target);
      }
      if(target.locked)throw Error('粘贴涉及锁定轨道');mapping.set(r.track_id,target.id);occupied.add(target.id);
    }
    const shift=anchor-Math.min(...rows.map(c=>c.content.start)),ids=new Map(rows.map(c=>[c.id,id('cue')]));
    for(const row of rows) {
      const content=clone(row.content);
      for(const field of ['color','sticker'])if(content[field+'_ref']) {
        const head=rows.find(c=>c.id===content[field+'_ref'].cue_id);
        if(!head)throw Error('复制内容缺少字幕标记，请重新复制');content[field]=clone(head.content[field]);delete content[field+'_ref'];
      }
      content.start+=shift;content.end+=shift;
      for(const item of content.items||[]){item.start+=shift;item.end+=shift;}
      for(const field of ['color','sticker'])if(content[field]){content[field].start=content.start;content[field].end=content.end;}
      E.frame(p,content);p.subtitles.cues.push({...clone(row),id:ids.get(row.id),track_id:mapping.get(row.track_id),content});
    }
    for(const b of bindings)if(ids.has(b.source_id)&&ids.has(b.target_id))p.subtitles.bindings.push({...clone(b),id:id('binding'),source_id:ids.get(b.source_id),target_id:ids.get(b.target_id)});
    core.validate(p);return {project:fromProject(p),ids:[...ids.values()]};
  }
  function insertAssets(view,ids,anchor,ownerId,normalize) {
    const assets=view.msw.subtitle_assets.filter(a=>ids.includes(a.id));
    if(!assets.length)throw Error('请选择字幕素材');
    if(new Set(assets.map(a=>a.source_id)).size>1)throw Error('请分批插入不同来源的字幕素材');
    if(!Number.isSafeInteger(anchor)||anchor<0)throw Error('插入位置无效');
    const rows=assets.map(a=>{const content=normalize({start:a.original_start,end:a.original_start+a.end-a.start,text:a.text,
      ...(a.items?{items:a.items.map(i=>({...clone(i),start:i.start+a.original_start-a.start,end:i.end+a.original_start-a.start}))}:{}),...(a.color?{color:clone(a.color)}:{}),
      ...(a.style?{style:clone(a.style)}:{}),...(a.split_mode?{split_mode:a.split_mode}:{})});
      return {id:a.id,track_id:a.subtitle_track_id||a.track_id||'main',content};});
    const links=[];
    for(const batch of view.msw.asset_batches||[])for(const b of batch.bindings||[]) {
      const a=assets.find(a=>a.batch_id===batch.id&&a.source_cue_id===b.main_segment_ids[0]),z=assets.find(a=>a.batch_id===batch.id&&a.source_cue_id===b.extension_segment_ids[0]);
      if(a&&z)links.push({id:b.id,source_id:a.id,target_id:z.id,start_offset_ms:b.start_offset_ms,end_offset_ms:b.end_offset_ms});
    }
    const result=place(view,rows,links,anchor,ownerId);return {...result,count:rows.length,rows:assets.map(a=>({id:a.id,text:a.text,reason:''}))};
  }
  function importSubtitles(view,segments,ownerId,name,{replace=false,matches=[],sources=[]}={}) {
    const E=global.MSWFlatEditing,makeId=global.MSWProject.id;let p=toProject(view);
    const owner=E.track(p,ownerId);if((replace||matches.length)&&(!owner||owner.locked))throw Error('请选择未锁定的字幕轨道');
    const incoming=core.migrate({segments:segments.map((c,i)=>({...clone(c),id:'import-'+i}))});
    if(replace)p=E.remove(p,p.subtitles.cues.filter(c=>c.track_id===ownerId).map(c=>c.id));
    const tracks=new Map();
    for(const [index,t] of incoming.subtitles.tracks.entries()) {
      const target=replace&&index===0?owner:{...clone(t),id:makeId('subtitle-track'),name:name+(index?' · '+(index+1):''),
        style:{mode:'inherit',base:'dialogue',slot:replace?(owner.style.slot||'main'):matches.length?'secondary':'main'}};
      if(target!==owner)p=core.addTrack(p,target);tracks.set(t.id,target.id);
    }
    const ids=new Map(),aliases=new Map(incoming.subtitles.migration.identities.map(a=>[a.id,a.cue_id]));
    for(const c of incoming.subtitles.cues)ids.set(c.id,makeId('cue'));
    const byIndex=new Map();
    for(const c of incoming.subtitles.cues) {
      const value=clone(c);value.id=ids.get(c.id);value.track_id=tracks.get(c.track_id);
      value.content.items||=[];
      for(const field of ['color','sticker'])if(value.content[field+'_ref'])value.content[field+'_ref'].cue_id=ids.get(value.content[field+'_ref'].cue_id);
      E.frame(p,value.content);p.subtitles.cues.push(value);byIndex.set(Number(aliases.get(c.id)?.replace('import-','')),value.id);
    }
    let bound=0;
    if(!replace)for(const match of matches) {
      const source=sources[match.mainIndex],target=byIndex.get(match.extensionIndex);
      if(source&&target&&!E.relation(p,source.id)) {p=core.bind(p,source.id,target,makeId('binding'));bound++;}
    }
    p.subtitle_view={...p.subtitle_view,secondary_cue_ids:[...(p.subtitle_view?.secondary_cue_ids||[]),
      ...((replace?owner.style.slot==='secondary':matches.length>0)?[...ids.values()]:[])]};
    core.validate(p);return {project:p,ids:[...ids.values()],bound};
  }
  function swapColumns(view) {
    const p=toProject(view),right=new Set(p.subtitle_view.secondary_cue_ids);
    p.subtitle_view.secondary_cue_ids=p.subtitles.cues.filter(c=>!right.has(c.id)).map(c=>c.id);
    core.validate(p);return p;
  }
  function reverseBindings(view,ids) {
    const p=toProject(view),chosen=new Set(ids),index=core.createIndex(p);
    for(const b of p.subtitles.bindings)if(chosen.has(b.source_id)||chosen.has(b.target_id)) {
      if(index.trackFor(b.source_id).locked||index.trackFor(b.target_id).locked)throw Error('绑定涉及锁定轨道');
      [b.source_id,b.target_id]=[b.target_id,b.source_id];
      b.start_offset_ms=-b.start_offset_ms;b.end_offset_ms=-b.end_offset_ms;
    }
    core.validate(p);return p;
  }
  function alignBindings(view,ids) {
    const p=toProject(view),chosen=new Set(ids),E=global.MSWFlatEditing;
    const changes=p.subtitles.bindings.filter(b=>chosen.has(b.source_id)||chosen.has(b.target_id)).map(b=>{
      E.editable(p,[b.source_id,b.target_id]);const source=E.cue(p,b.source_id).content;
      return {id:b.target_id,start:source.start,end:source.end};
    });
    // One transaction: a collision leaves every member unchanged.
    return E.updateRanges(p,changes,{linked:false});
  }
  // Candidate edits can be applied again, but only while their last result is
  // unchanged. Restore just the touched cues, never an entire stale project.
  function applyResults(view,media,jobs,target) {
    const F=global.MSWFlatProcessing,E=global.MSWFlatEditing,R=global.MSWResults;
    let p=toProject(view);R.register(p.msw,jobs);const batch=R.record(p.msw,jobs[0]),revision=R.revision(jobs),previous=batch.applications[target];
    if(previous?.revision===revision)return {duplicate:true};
    if(previous?.state?.flat) {
      const state=previous.state,ids=new Set([...state.before.cues,...state.after.cues].map(c=>c.id));
      const current={cues:p.subtitles.cues.filter(c=>ids.has(c.id)),bindings:p.subtitles.bindings.filter(b=>ids.has(b.source_id)||ids.has(b.target_id))};
      const ordered=x=>({cues:[...x.cues].sort((a,b)=>a.id.localeCompare(b.id)),bindings:[...x.bindings].sort((a,b)=>a.id.localeCompare(b.id))});
      if(!F.same(ordered(current),ordered(state.after)))throw Error('已应用的字幕又被编辑，未覆盖；可先撤销编辑或将候选存入素材库');
      p.subtitles.cues=p.subtitles.cues.filter(c=>!ids.has(c.id)).concat(clone(state.before.cues));
      p.subtitles.bindings=p.subtitles.bindings.filter(b=>!ids.has(b.source_id)&&!ids.has(b.target_id)).concat(clone(state.before.bindings));
    }
    const before=clone(p.subtitles);
    for(const raw of jobs) {
      const job=clone(raw),s=job.snapshot;
      if(s?.project_schema!==core.SCHEMA)throw Error('这是迁移前的处理记录，请重新处理或先存入素材库');
      p.msw.applied_results=(p.msw.applied_results||[]).filter(id=>id!==job.id);
      if(job.kind==='translation'&&target==='main') {
        if(job.project_id!==p.msw.project_id||job.status!=='succeeded')throw Error('翻译结果不属于当前工程');
        for(const entry of s.entries) {
          const original=s.flat_model.cues.find(c=>c.id===entry.source.id),now=E.cue(p,entry.source.id);
          if(!F.same(original,now))throw Error('翻译来源已变化，未覆盖');
          E.editable(p,[now.id]);
          const row=job.result.translations.find(r=>r.id===now.id);if(!row?.text?.trim())throw Error('翻译结果缺少字幕');
          now.content.text=row.text;delete now.content.items;now.content._dirty=true;
        }
        p.msw.applied_results.push(job.id);
      } else {
        if(job.kind==='translation'&&s.created_subtitle_track&&!E.track(p,s.subtitle_track_id))p=core.addTrack(p,clone(s.created_subtitle_track));
        p=(job.kind==='asr'?F.applyAsr(p,job,media,global.MSWProject.id):F.applyTranslation(p,job,global.MSWProject.id)).project;
      }
    }
    const old=new Map(before.cues.map(c=>[c.id,c])),now=new Map(p.subtitles.cues.map(c=>[c.id,c]));
    const ids=new Set([...old.keys(),...now.keys()].filter(id=>!F.same(old.get(id),now.get(id))));
    const subset=m=>({cues:m.cues.filter(c=>ids.has(c.id)),bindings:m.bindings.filter(b=>ids.has(b.source_id)||ids.has(b.target_id))});
    R.record(p.msw,jobs[0]).applications[target]={revision,state:{flat:true,before:previous?.state?.flat?previous.state.before:subset(before),after:subset(p.subtitles)}};
    core.validate(p);return {project:fromProject(p),count:ids.size};
  }
  // Export a disposable snapshot: keep identities, bindings, styles and layout,
  // and change only which physical tracks participate in this output.
  function exportScope(input,trackIds=null) {
    const p=toProject(input),selected=trackIds===null?null:new Set(trackIds);
    for(const t of p.subtitles.tracks)t.enabled=t.enabled&&(!selected||selected.has(t.id));
    return p;
  }
  // A gesture uses stable cue IDs, never display-column indices or binding
  // direction. Only its participating content is copied for preview/rollback.
  function prepareMove(view, selectedIds, anchorId) {
    const ids=new Set(selectedIds);ids.add(anchorId);
    const neighbours=new Map();
    for(const b of view.multi_subtitle.bindings) {
      const a=b.main_segment_ids[0],z=b.extension_segment_ids[0];
      neighbours.set(a,z);neighbours.set(z,a);
    }
    for(const id of ids)if(neighbours.has(id))ids.add(neighbours.get(id));
    const owners=new Map(view.subtitle_tracks.assignments.map(a=>[a.cue_id,a.subtitle_track_id]));
    const tracks=clone(view.subtitle_tracks.tracks),byTrack=new Map(tracks.map(t=>[t.id,t]));
    const entries=layers.tracks(view).flatMap(source=>source.segments.flatMap((cue,index)=>ids.has(cue.id)
      ? [{cue,index,source,owner:owners.get(cue.id),original:clone(cue)}] : []));
    if(entries.length!==ids.size)throw Error('移动对象已不存在，请重新选择字幕');
    for(const e of entries)if(!byTrack.has(e.owner)||byTrack.get(e.owner).locked)throw Error('操作包含锁定或不存在的源轨道');
    return {entries,tracks,anchorId,anchorOwner:owners.get(anchorId)};
  }
  function moveOwners(plan, destination) {
    const {tracks,entries,anchorOwner}=plan,byId=new Map(tracks.map(t=>[t.id,t]));
    const root=id=>byId.get(id)?.secondary_for||id;
    const mate=id=>tracks.find(t=>t.secondary_for===root(id));
    if(!byId.has(destination))throw Error('请选择有效的字幕轨道');
    const used=new Set(entries.map(e=>e.owner)),sourceMate=mate(anchorOwner);
    const paired=sourceMate&&used.has(root(anchorOwner))&&used.has(sourceMate.id);
    const roots=tracks.filter(t=>!t.secondary_for);
    const shift=paired?roots.findIndex(t=>t.id===root(destination))-roots.findIndex(t=>t.id===root(anchorOwner))
      :tracks.findIndex(t=>t.id===destination)-tracks.findIndex(t=>t.id===anchorOwner);
    const mapping=new Map();
    for(const owner of used) {
      let target;
      if(paired) {
        const group=roots[roots.findIndex(t=>t.id===root(owner))+shift];
        target=byId.get(owner).secondary_for?(group&&mate(group.id)):group;
        if(group&&mate(owner)&&used.has(root(owner))&&used.has(mate(owner).id)&&!mate(group.id))
          throw Error(`${group.name} 没有对应副轨道，无法放置整组字幕`);
      } else target=tracks[tracks.findIndex(t=>t.id===owner)+shift];
      if(!target)throw Error('没有足够的轨道容纳所选字幕');
      if(target.locked)throw Error(`${target.name} 已锁定，请先解锁`);
      mapping.set(owner,target.id);
    }
    if(new Set(mapping.values()).size!==mapping.size)throw Error('目标轨道无法一一对应，请选择其他轨道组');
    return new Map(entries.map(e=>[e.cue.id,mapping.get(e.owner)]));
  }
  const api={isView,fromProject,toProject,normalizeView,translation,translationIds,translationScope,trackSelection,applyResults,place,insertAssets,importSubtitles,swapColumns,reverseBindings,alignBindings,exportScope,prepareMove,moveOwners,EXT};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MSWProductionProject=api;
})(typeof globalThis!=='undefined'?globalThis:this);
