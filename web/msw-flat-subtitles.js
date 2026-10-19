// Role-independent subtitle storage. The normal editor uses a reversible
// operation view for its existing components; persistence always uses v4.
(function(global) {
  'use strict';
  const old = typeof module !== 'undefined' && module.exports ? require('./msw-subtitle-tracks.js') : global.MSWSubtitleTracks;
  const SCHEMA='msw.project.v4', MODEL_SCHEMA='msw.subtitles.v1', MIGRATION_SCHEMA='msw.subtitle-migration.v1';
  const cueStyle=typeof module!=='undefined'&&module.exports?require('./msw-cue-style.js'):global.MSWCueStyle;
  const structural=['segments','multi_subtitle','subtitle_tracks','subtitle_layers','overlay_track'];
  const clone=value=>JSON.parse(JSON.stringify(value));
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const stable=value=>typeof value==='string'&&!!value.trim()&&value.length<=160;
  const integer=value=>Number.isSafeInteger(value)&&value>=0;
  const fail=message=>{throw Error('平级字幕：'+message);};
  const aliasKey=ref=>JSON.stringify([ref.role,ref.track_id,ref.cue_id]);
  // Deterministic identity, not a security/content hash. UTF-16LE matches Python
  // including opaque legacy IDs; collisions are rejected instead of merged.
  function identity(prefix,key) {
    let hash=0xcbf29ce484222325n;
    for(let i=0;i<key.length;i++)for(const byte of [key.charCodeAt(i)&255,key.charCodeAt(i)>>>8])hash=BigInt.asUintN(64,(hash^BigInt(byte))*0x100000001b3n);
    return prefix+'-'+hash.toString(16).padStart(16,'0');
  }
  function jsonValue(value,seen=new Set()) {
    if(value===null||typeof value==='string'||typeof value==='boolean')return;
    if(typeof value==='number'&&Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value)))return;
    if(Array.isArray(value)||object(value)) {
      if(seen.has(value))fail('包含循环引用');
      seen.add(value);Object.values(value).forEach(v=>jsonValue(v,seen));seen.delete(value);return;
    }
    fail('包含不能保存为 JSON 的值');
  }
  function framePair(value) {
    if(Object.hasOwn(value,'start_frame')!==Object.hasOwn(value,'end_frame')
      ||Object.hasOwn(value,'start_frame')&&(!integer(value.start_frame)||!integer(value.end_frame)||value.end_frame<=value.start_frame))fail('帧时间码无效');
  }
  function contentValid(cue) {
    if(!object(cue)||Object.hasOwn(cue,'id')||!integer(cue.start)||!integer(cue.end)||cue.end<=cue.start||typeof cue.text!=='string'
      ||Object.hasOwn(cue,'disabled')&&typeof cue.disabled!=='boolean')fail('字幕时间或正文无效');
    framePair(cue);
    if(Object.hasOwn(cue,'subtitle_style')&&!cueStyle.valid(cue.subtitle_style))fail('字幕外观覆盖包含无效参数');
    if(Object.hasOwn(cue,'subtitle_style_preset')&&!stable(cue.subtitle_style_preset))fail('字幕外观预设标识无效');
    if(Object.hasOwn(cue,'speaker')&&(typeof cue.speaker!=='string'||!cue.speaker.trim()))fail('说话人无效');
    if(Object.hasOwn(cue,'items')) {
      if(!Array.isArray(cue.items))fail('逐词时间码必须是数组');
      let previous=cue.start;
      for(const item of cue.items) {
        if(!object(item)||!integer(item.start)||!integer(item.end)||item.start<previous||item.end<item.start||item.end>cue.end||typeof item.text!=='string')fail('逐词时间码无效');
        framePair(item);previous=item.end;
      }
    }
    if(Object.hasOwn(cue,'subtitle_position')) {
      const p=cue.subtitle_position;
      if(!object(p)||Object.keys(p).some(k=>!['x','y','alignment','base'].includes(k))
        ||!['x','y'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1)
        ||Object.hasOwn(p,'alignment')&&(!Number.isInteger(p.alignment)||p.alignment<1||p.alignment>9)
        ||Object.hasOwn(p,'base')&&(!Object.hasOwn(p,'alignment')||!object(p.base)||Object.keys(p.base).length!==2
          ||!['x','y'].every(k=>typeof p.base[k]==='number'&&Number.isFinite(p.base[k])&&p.base[k]>=0&&p.base[k]<=1)))fail('字幕位置无效');
    }
    for(const field of ['color','sticker'])if(cue[field]!=null) {
      const head=cue[field];
      if(!object(head)||Object.hasOwn(head,'name')&&(typeof head.name!=='string'||!head.name.trim())
        ||['start','end'].some(k=>Object.hasOwn(head,k)&&!Number.isSafeInteger(head[k]))
        ||Object.hasOwn(head,'start')&&Object.hasOwn(head,'end')&&head.end<head.start)fail('字幕标记无效');
    }
  }
  function validate(project) {
    jsonValue(project);
    if(!object(project)||project.schema!==SCHEMA)fail('不支持的工程版本');
    if(structural.some(k=>Object.hasOwn(project,k)))fail('新工程不能同时保存旧主副正文或归属');
    if(Object.hasOwn(project,'timebase')&&(!object(project.timebase)||!['milliseconds','frames'].includes(project.timebase.unit)
      ||typeof project.timebase.fps!=='number'||project.timebase.fps<1||project.timebase.fps>240))fail('时间基准无效');
    const m=project.subtitles;
    if(!object(m)||m.schema!==MODEL_SCHEMA||!Array.isArray(m.tracks)||!m.tracks.length||!Array.isArray(m.cues)||!Array.isArray(m.bindings))fail('字幕结构无效');
    const tracks=new Map(),cues=new Map(),lanes=new Map();
    for(const track of m.tracks) {
      if(!object(track)||!stable(track.id)||tracks.has(track.id)||!stable(track.name)
        ||['parent_id','children','segments','cues'].some(k=>Object.hasOwn(track,k))
        ||!['none','dialogue','source','translation','annotation'].includes(track.purpose)
        ||!['auto','fixed'].includes(track.layout)||['enabled','locked','collapsed'].some(k=>typeof track[k]!=='boolean')
        ||!object(track.style)||!['main','secondary'].includes(track.style.slot)||!['dialogue','annotation'].includes(track.style.base))fail('轨道身份、状态或样式无效');
      if(Object.hasOwn(track,'split_mode')&&!['auto','word','continuous'].includes(track.split_mode))fail('轨道文字切分方式无效');
      const style=clone(track.style);delete style.slot;delete style.base;
      const check=old.migrate({segments:[]}),t=check.subtitle_tracks.tracks[0];t.style=style;
      if(Object.hasOwn(track,'position'))t.position=track.position;
      old.validate(check);tracks.set(track.id,track);lanes.set(track.id,[]);
    }
    validateGroups(m);
    for(const cue of m.cues) {
      if(!object(cue)||!stable(cue.id)||cues.has(cue.id)||!tracks.has(cue.track_id)
        ||Object.hasOwn(cue,'hidden')&&typeof cue.hidden!=='boolean')fail('字幕身份、归属或显示状态无效');
      contentValid(cue.content);
      cues.set(cue.id,cue);lanes.get(cue.track_id).push(cue);
    }
    for(const lane of lanes.values()) {
      lane.sort((a,b)=>a.content.start-b.content.start);
      for(let i=1;i<lane.length;i++)if(lane[i].content.start<lane[i-1].content.end)fail('同一轨道的字幕重叠');
    }
    for(const cue of cues.values())for(const field of ['color_ref','sticker_ref'])if(cue.content[field]!=null) {
      const ref=cue.content[field],headField=field.replace('_ref',''),target=cues.get(ref?.cue_id)?.content[headField];
      if(!object(ref)||Object.hasOwn(ref,'headIdx')||ref.cue_id===cue.id||cue.content[headField]!=null||!object(target)
        ||typeof target.name==='string'&&typeof ref.name==='string'&&target.name!==ref.name)fail('字幕标记引用失效');
    }
    const used=new Set(),ids=new Set();
    for(const link of m.bindings) {
      const a=cues.get(link?.source_id),b=cues.get(link?.target_id);
      if(!object(link)||!stable(link.id)||ids.has(link.id)||!a||!b||a.id===b.id||a.track_id===b.track_id||used.has(a.id)||used.has(b.id)
        ||!Number.isSafeInteger(link.start_offset_ms)||link.start_offset_ms!==b.content.start-a.content.start
        ||!Number.isSafeInteger(link.end_offset_ms)||link.end_offset_ms!==b.content.end-a.content.end)fail('对应关系重复、失效或时间偏移不一致');
      used.add(a.id);used.add(b.id);ids.add(link.id);
    }
    if(m.migration!==undefined) {
      const h=m.migration;
      if(!object(h)||h.schema!==MIGRATION_SCHEMA||!object(h.structure)||!Array.isArray(h.identities)
        ||Object.keys(h.structure).some(k=>!structural.includes(k)))fail('迁移来源记录无效');
      const aliases=new Set(),aliasIds=new Set();
      for(const a of h.identities) {
        if(!object(a)||!stable(a.id)||aliasIds.has(a.id)||!stable(a.cue_id)||!['main','extension'].includes(a.role)
          ||(a.role==='main'?a.track_id!==null:!stable(a.track_id))||aliases.has(aliasKey(a)))fail('旧字幕身份映射无效');
        aliases.add(aliasKey(a));aliasIds.add(a.id);
        if(a.id!==identity('cue',aliasKey(a)))fail('旧字幕身份映射不一致');
        if(Object.hasOwn(a,'reference_extras')&&(!object(a.reference_extras)||Object.entries(a.reference_extras).some(([k,v])=>
          !['color_ref','sticker_ref'].includes(k)||!object(v)||Object.keys(v).length!==1||!Object.hasOwn(v,'cue_id'))))fail('旧标记扩展字段无效');
      }
      const multi=h.structure.multi_subtitle;
      if(multi!=null&&(!object(multi)||!Array.isArray(multi.tracks)||multi.tracks.some(t=>!object(t)||!stable(t.id))))fail('迁移来源副字幕结构无效');
      const sources=[{role:'main',track_id:null,segments:h.structure.segments},...(multi?.tracks||[]).map(t=>({role:'extension',track_id:t.id,segments:t.segments}))];
      const byId=new Map(h.identities.map(a=>[a.id,a])),listed=new Set();
      if(h.structure.overlay_track?.segments?.length)fail('迁移来源不能包含第二份正文');
      for(const source of sources) {
        if(!Array.isArray(source.segments))fail('迁移来源只能保存字幕身份列表');
        for(const id of source.segments) {
          const alias=byId.get(id);
          if(!alias||listed.has(id)||alias.role!==source.role||alias.track_id!==source.track_id)fail('迁移来源身份列表不一致');
          listed.add(id);
        }
      }
      if(listed.size!==aliasIds.size)fail('迁移来源身份列表不完整');
    }
    return true;
  }
  // Track groups are display/style relationships, never cue ownership or bindings.
  function validateGroups(m) {
    const numbers=new Map(),members=new Set(),tracks=new Map(m.tracks.map(t=>[t.id,t]));
    for(const t of m.tracks) {
      if(t.display_number!==undefined) {
        if(!Number.isSafeInteger(t.display_number)||t.display_number<1)fail('轨道编号无效或重复');
        const owner=t.secondary_for||t.id;
        if(numbers.has(t.display_number)&&numbers.get(t.display_number)!==owner)fail('轨道编号无效或重复');
        numbers.set(t.display_number,owner);
      }
      if(t.secondary_for!==undefined) {
        const main=tracks.get(t.secondary_for);
        if(!main||main===t||main.secondary_for!==undefined||members.has(main.id))fail('主副轨道分组必须为一主一副');
        members.add(main.id);
      }
    }
    if(m.next_track_number!==undefined&&(!Number.isSafeInteger(m.next_track_number)||m.next_track_number<1||[...numbers.keys()].some(n=>n>=m.next_track_number)))fail('后续轨道编号无效');
  }
  function normalizeGroups(project,{infer=false}={}) {
    const m=project.subtitles,tracks=m.tracks,ids=new Set(tracks.map(t=>t.id));
    const fresh=tracks.every(t=>t.display_number===undefined);
    for(const t of tracks)if(t.secondary_for&&!ids.has(t.secondary_for))delete t.secondary_for;
    if(infer&&fresh&&tracks.every(t=>t.secondary_for===undefined)) {
      const cues=new Map(m.cues.map(c=>[c.id,c.track_id])),out=new Map(),incoming=new Map();
      for(const b of m.bindings) {
        const a=cues.get(b.source_id),z=cues.get(b.target_id);
        if(!a||!z)continue;if(!out.has(a))out.set(a,new Set());out.get(a).add(z);
        if(!incoming.has(z))incoming.set(z,new Set());incoming.get(z).add(a);
      }
      for(const [a,targets] of out)if(targets.size===1&&!incoming.has(a)) {
        const z=[...targets][0];if(incoming.get(z).size===1&&!out.has(z))tracks.find(t=>t.id===z).secondary_for=a;
      }
    }
    const roots=tracks.filter(t=>!t.secondary_for);
    const maximum=Math.max(0,...roots.map(t=>t.display_number||0));
    const released=new Set(tracks.filter(t=>t.secondary_for&&t.display_number!==undefined
      &&t.display_number!==tracks.find(a=>a.id===t.secondary_for)?.display_number).map(t=>t.display_number));
    let next=Math.max(m.next_track_number||1,maximum+1);
    // Reclaim only trailing numbers formerly reserved for a secondary track.
    // Existing independent numbers and deleted-track reservations stay stable.
    while(next>maximum+1&&released.has(next-1))next--;
    for(const t of roots)if(t.display_number===undefined)t.display_number=next++;
    for(const t of tracks)if(t.secondary_for)t.display_number=tracks.find(a=>a.id===t.secondary_for)?.display_number;
    m.next_track_number=next;
    validateGroups(m);
    for(const t of tracks) {
      const main=t.secondary_for?tracks.find(a=>a.id===t.secondary_for):t;
      t.name='S'+main.display_number+(t.secondary_for?'副':tracks.some(a=>a.secondary_for===t.id)?'主':'');
    }
    return project;
  }
  function setTrackGroup(project,secondaryId,mainId=null) {
    validate(project);const next=normalizeGroups(clone(project)),tracks=next.subtitles.tracks;
    const secondary=tracks.find(t=>t.id===secondaryId),main=tracks.find(t=>t.id===mainId);
    if(!secondary||secondary.locked)fail('轨道不存在或已锁定');
    const previous=tracks.find(t=>t.id===secondary.secondary_for),child=tracks.find(t=>t.secondary_for===secondary.id);
    if(previous?.locked||child?.locked)fail('分组中的轨道已锁定');
    if(mainId!==null&&(!main||main===secondary||main.locked||main.secondary_for||child||tracks.some(t=>t.secondary_for===mainId&&t.id!==secondaryId)))fail('请选择未分组且未锁定的主轨道');
    delete secondary.secondary_for;
    if(previous&&!main)delete secondary.display_number;
    if(child){delete child.secondary_for;delete child.display_number;}
    if(main)secondary.secondary_for=main.id;
    normalizeGroups(next);validate(next);return next;
  }
  function migrate(input) {
    if(input?.schema===SCHEMA){validate(input);return clone(input);}
    if(input&&Object.hasOwn(input,'subtitles'))fail('旧工程含有保留的新结构字段，未覆盖');
    jsonValue(input);
    const project=old.migrate(input),index=old.createIndex(project),rows=index.records({includeHidden:true});
    const m={schema:MODEL_SCHEMA,tracks:[],cues:[],bindings:[]};
    const identities=rows.map(r=>({id:identity('cue',aliasKey(r)),role:r.role,track_id:r.track_id,cue_id:r.cue_id}));
    if(new Set(identities.map(a=>a.id)).size!==identities.length)fail('身份编码冲突，未修改工程');
    const byAlias=new Map(identities.map(a=>[aliasKey(a),a.id])),aliases=new Map(identities.map(a=>[a.id,a])),sourceCues=new Map();
    sourceCues.set(aliasKey({role:'main',track_id:null,cue_id:null}),project.segments);
    for(const t of project.multi_subtitle?.tracks||[])sourceCues.set(aliasKey({role:'extension',track_id:t.id,cue_id:null}),t.segments);
    const ownerTracks=new Map(),trackIds=new Set(project.subtitle_tracks.tracks.map(t=>t.id));
    const occupied=new Set(rows.map(r=>JSON.stringify([r.subtitle_track_id,r.track_id])));
    for(const [i,t] of project.subtitle_tracks.tracks.entries()) {
      const add=(role,storage=null)=>{
        const key=JSON.stringify([t.id,role,storage?.id??null]);
        let id=role==='main'?t.id:identity('track',key),n=1;
        if(role!=='main'){const base=id;while(trackIds.has(id))id=base+'-'+n++;trackIds.add(id);}
        const label=storage&&(typeof storage.name==='string'&&storage.name||typeof storage.language==='string'&&storage.language)||'副字幕';
        const track={id,name:role==='main'?t.name:`${t.name} · ${label}`.slice(0,160).replace(/[\uD800-\uDBFF]$/,''),
          purpose:role==='main'?old.purpose(t):'translation',layout:old.placement(t),enabled:t.enabled&&(role==='main'||project.multi_subtitle.enabled===true),
          locked:t.locked,collapsed:t.collapsed,style:{...clone(t.style),slot:role==='main'?'main':'secondary',base:old.styleKind(t)}};
        if(t.position)track.position=clone(t.position);
        if(storage?.language)track.language=storage.language;
        const splitMode=role==='main'?(project.multi_subtitle?.main_split_mode||project.split_mode):storage?.split_mode;
        if(['word','continuous'].includes(splitMode))track.split_mode=splitMode;
        m.tracks.push(track);ownerTracks.set(key,id);
      };
      add('main');
      for(const storage of project.multi_subtitle?.tracks||[])if(occupied.has(JSON.stringify([t.id,storage.id]))||i===0&&!storage.segments.length)add('extension',storage);
    }
    const hidden=new Set(project.subtitle_layers.legacy_overlay.visible?[]:project.subtitle_layers.legacy_overlay.cue_ids);
    for(const row of rows) {
      const cue={id:byAlias.get(aliasKey(row)),track_id:ownerTracks.get(JSON.stringify([row.subtitle_track_id,row.role,row.track_id])),content:clone(row.cue)};
      delete cue.content.id;
      if(row.role==='main'&&hidden.has(row.cue_id))cue.hidden=true;
      for(const field of ['color_ref','sticker_ref'])if(cue.content[field]!=null) {
        const ref=cue.content[field],head=sourceCues.get(aliasKey({...row,cue_id:null}))[ref?.headIdx];
        if(!Number.isSafeInteger(ref.headIdx)||ref.headIdx<0||ref.headIdx>=row.index||!head)fail('旧字幕标记引用失效');
        if(Object.hasOwn(ref,'cue_id')){const a=aliases.get(cue.id);(a.reference_extras??={})[field]={cue_id:ref.cue_id};}
        cue.content[field]={...ref,cue_id:byAlias.get(aliasKey({...row,cue_id:head.id}))};delete cue.content[field].headIdx;
      }
      m.cues.push(cue);
    }
    const cueMap=new Map(m.cues.map(c=>[c.id,c]));
    for(const b of project.multi_subtitle?.bindings||[]) {
      const track=b.track_id??project.multi_subtitle.tracks[0]?.id;
      const source_id=byAlias.get(aliasKey({role:'main',track_id:null,cue_id:b.main_segment_ids?.[0]??b.main_segment_id}));
      const target_id=byAlias.get(aliasKey({role:'extension',track_id:track,cue_id:b.extension_segment_ids?.[0]??b.extension_segment_id}));
      const a=cueMap.get(source_id).content,c=cueMap.get(target_id).content;
      m.bindings.push({id:b.id||identity('binding',JSON.stringify([source_id,target_id])),source_id,target_id,start_offset_ms:c.start-a.start,end_offset_ms:c.end-a.end});
    }
    const result=clone(project),structure={};
    for(const field of structural)if(Object.hasOwn(result,field)){structure[field]=result[field];delete result[field];}
    structure.segments=project.segments.map(c=>byAlias.get(aliasKey({role:'main',track_id:null,cue_id:c.id})));
    for(const t of structure.multi_subtitle?.tracks||[])t.segments=t.segments.map(c=>byAlias.get(aliasKey({role:'extension',track_id:t.id,cue_id:c.id})));
    m.migration={schema:MIGRATION_SCHEMA,structure,identities};
    result.schema=SCHEMA;result.subtitles=m;validate(result);return result;
  }
  function createIndex(project) {
    validate(project);const m=project.subtitles,tracks=new Map(m.tracks.map(t=>[t.id,t])),cues=new Map(m.cues.map(c=>[c.id,c]));
    const aliases=new Map((m.migration?.identities||[]).map(a=>[aliasKey(a),a.id]));
    return {resolve:id=>cues.get(id)||null,trackFor:id=>tracks.get(cues.get(id)?.track_id)||null,
      resolveLegacy:ref=>object(ref)?cues.get(aliases.get(aliasKey(ref)))||null:null,
      resolveSource:ref=>!object(ref)||ref.kind==='editor_text'?null:Object.hasOwn(ref,'subtitle_cue_id')?cues.get(ref.subtitle_cue_id)||null:
        cues.get(aliases.get(aliasKey({role:ref.track_id==null?'main':'extension',track_id:ref.track_id??null,cue_id:ref.source_cue_id??ref.id})))||null,
      records:({trackId,includeHidden=false,includeDisabled=true}={})=>m.cues.filter(c=>(!trackId||c.track_id===trackId)&&(includeHidden||tracks.get(c.track_id).enabled&&!c.hidden)&&(includeDisabled||!c.content.disabled)),
      partners:id=>m.bindings.filter(b=>b.source_id===id||b.target_id===id).map(b=>cues.get(b.source_id===id?b.target_id:b.source_id))};
  }
  function move(project,ids,targetId) {
    const index=createIndex(project),target=project.subtitles.tracks.find(t=>t.id===targetId);
    if(!Array.isArray(ids)||!ids.length||!target||target.locked)fail('移动目标不存在或已锁定');
    for(const id of ids)if(!index.resolve(id)||index.trackFor(id).locked)fail('字幕不存在或轨道已锁定');
    const next=clone(project),wanted=new Set(ids);for(const cue of next.subtitles.cues)if(wanted.has(cue.id))cue.track_id=targetId;
    validate(next);return next;
  }
  function addTrack(project,track) {
    validate(project);const next=clone(project),added=clone(track);delete added.display_number;
    next.subtitles.tracks.push(added);if(next.subtitles.next_track_number)normalizeGroups(next);
    validate(next);return next;
  }
  function bind(project,sourceId,targetId,id) {
    const index=createIndex(project),source=index.resolve(sourceId),target=index.resolve(targetId);
    if(!source||!target||index.trackFor(sourceId).locked||index.trackFor(targetId).locked)fail('对应对象不存在或轨道已锁定');
    const next=clone(project);next.subtitles.bindings.push({id,source_id:sourceId,target_id:targetId,start_offset_ms:target.content.start-source.content.start,end_offset_ms:target.content.end-source.content.end});validate(next);return next;
  }
  function unbind(project,id) {
    const index=createIndex(project),link=project.subtitles.bindings.find(b=>b.id===id);
    if(!link||[link.source_id,link.target_id].some(c=>index.trackFor(c).locked))fail('对应关系不存在或轨道已锁定');
    const next=clone(project);next.subtitles.bindings=next.subtitles.bindings.filter(b=>b.id!==id);return next;
  }
  function legacyProjection(project) {
    validate(project);const h=project.subtitles.migration;
    if(!h)fail('此工程没有可无损还原的旧版视图');
    const result=clone(project);delete result.subtitles;result.schema=old.SCHEMA;Object.assign(result,clone(h.structure));
    const cues=new Map(project.subtitles.cues.map(c=>[c.id,c])),aliases=new Map(h.identities.map(a=>[a.id,a]));
    const sources=[{role:'main',track_id:null,segments:result.segments},...(result.multi_subtitle?.tracks||[]).map(t=>({role:'extension',track_id:t.id,segments:t.segments}))];
    for(const source of sources) {
      const headIndices=new Map(source.segments.map((id,i)=>[id,i]));
      for(let i=0;i<source.segments.length;i++) {
      const id=source.segments[i],original=cues.get(id),alias=aliases.get(id);
      if(!original||!alias)fail('新结构已超出旧版视图的表达能力；请使用平级轨道编辑器');
      const cue=clone(original.content);cue.id=alias.cue_id;
      for(const field of ['color_ref','sticker_ref'])if(cue[field]!=null) {
        const head=aliases.get(cue[field].cue_id);
        if(!head||head.role!==source.role||head.track_id!==source.track_id)fail('跨来源标记引用不能无损还原到旧版');
        cue[field]={...cue[field],headIdx:headIndices.get(cue[field].cue_id)};delete cue[field].cue_id;
        Object.assign(cue[field],alias.reference_extras?.[field]||{});
      }
      source.segments[i]=cue;
      }
    }
    const rebuilt=migrate(result);
    // Provenance is immutable. Metadata/relationship edits that old v3 cannot
    // express must fail visibly, never flatten tracks or drop unknown members.
    const comparable=p=>{const m=clone(p.subtitles);delete m.migration;return m;};
    const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
    if(JSON.stringify(canonical(comparable(rebuilt)))!==JSON.stringify(canonical(comparable(project))))fail('新结构已超出旧版视图的表达能力；不能降级保存');
    return result;
  }
  const api={SCHEMA,MODEL_SCHEMA,MIGRATION_SCHEMA,identity,validate,migrate,createIndex,addTrack,move,bind,unbind,legacyProjection,normalizeGroups,setTrackGroup};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  global.MSWFlatSubtitles=api;
})(typeof globalThis!=='undefined'?globalThis:this);
