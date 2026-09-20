// Pure source/range snapshots and replacement conflict detection.
(function (global) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const overlaps = (a,b) => a.start < b.end && b.start < a.end;
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).filter(key => !key.startsWith('_')).sort()
      .map(key => [key, canonical(value[key])]));
  }
  const affected = (project,mode,range) => (project.segments || []).filter(cue => overlaps(cue,range));
  function boundaries(project,range,duration) {
    if (!range) return {crossing:[],expanded:null,canExpand:false};
    let start=range.start,end=range.end;
    const crossing=affected(project,'range',range).filter(cue=>cue.start<start||cue.end>end);
    let changed=true;
    while (changed) {
      changed=false;
      for (const cue of project.segments || []) if (overlaps(cue,{start,end})) {
        const low=Math.min(start,cue.start),high=Math.max(end,cue.end);
        if (low!==start||high!==end) {start=low;end=high;changed=true;}
      }
    }
    return {crossing,expanded:{start,end},canExpand:start>=0&&end<=duration};
  }
  function snapshot(project,media,mode,range) {
    if (!media || !media.revision || !media.metadata?.duration_ms || !media.metadata.audio_tracks?.length) throw Error('请先导入包含音轨的媒体');
    const duration=media.metadata.duration_ms;
    if (mode==='whole') range={start:0,end:duration};
    if (!['whole','range'].includes(mode)||!range||![range.start,range.end].every(Number.isSafeInteger)
      ||range.start<0||range.end>duration||range.end<=range.start) throw Error('请选择源媒体内的有效时间范围；未改为整段识别');
    if (mode==='range'&&boundaries(project,range,duration).crossing.length) throw Error('选区切穿已有字幕；请调整范围或先扩展到完整字幕边界');
    return {project_id:project.msw.project_id,mode,range:clone(range),
      source:{id:media.id,revision:media.revision,reference:media.reference,name:media.name,audio_index:media.audio_index,duration_ms:duration},
      targets:affected(project,mode,range).map(canonical)};
  }
  function clipSnapshots(project,clips) {
    if(!clips?.length)throw Error('请先选择音频贴片');
    return clips.map(clip=>{
      const asset=(project.msw.assets||[]).find(a=>a.id===clip.asset_id);
      if(!asset)throw Error('所选贴片缺少音频素材');
      const range={start:clip.start_ms,end:clip.start_ms+Math.max(1,Math.ceil((clip.source_out_sample-clip.source_in_sample)*1000/asset.sample_rate))};
      return {project_id:project.msw.project_id,mode:'clips',range,targets:affected(project,'range',range).map(canonical),
        source:{kind:'clip',id:asset.id,revision:asset.sha256,name:clip.label||asset.generation.display_text,reference:'',audio_index:0,
          duration_ms:Math.ceil(asset.sample_count*1000/asset.sample_rate),
          clip:Object.fromEntries(['id','asset_id','start_ms','source_in_sample','source_out_sample','playback_rate'].map(k=>[k,clip[k]]))}};
    });
  }
  function conflict(project,media,input) {
    if (project.msw?.project_id!==input.project_id) return '结果属于其他工程';
    if (input.mode==='clips') {
      const clip=(project.msw.audio_clips||[]).find(c=>c.id===input.source.clip.id);
      const asset=(project.msw.assets||[]).find(a=>a.id===input.source.id);
      if(!clip||!asset||asset.sha256!==input.source.revision||Object.keys(input.source.clip).some(k=>clip[k]!==input.source.clip[k]))return '音频贴片已移动、裁剪、替换或删除';
    } else if (!media||media.id!==input.source.id||media.revision!==input.source.revision||media.audio_index!==input.source.audio_index) return '媒体或源音轨已改变';
    const now=affected(project,input.mode,input.range).map(canonical);
    if (JSON.stringify(now)!==JSON.stringify(input.targets.map(canonical))) return '目标范围内字幕已新增、删除、拆分、移动或编辑，请重新识别';
    if(boundaries(project,input.range,Infinity).crossing.length)return '识别范围切穿已有字幕，请调整字幕边界或存入素材库';
    return '';
  }
  function plan(project,media,job,{splitGroups=null}={}) {
    if (job.status!=='succeeded'||!job.snapshot||!job.result||!global.MSWProject.validId(job.id)) throw Error('ASR 结果尚未完成');
    if (project.msw?.applied_results?.includes(job.id)) return {applied:false,duplicate:true};
    const issue=conflict(project,media,job.snapshot);if(issue)throw Error(issue);
    const candidates=job.result.segments;
    if (!Array.isArray(candidates)||candidates.length>10000) throw Error('ASR 候选字幕无效');
    if (!candidates.length) return {applied:false,empty:true};
    let previousEnd=job.snapshot.range.start;
    const inserted=candidates.map((cue,index)=>{
      if (!cue||!Number.isSafeInteger(cue.start)||!Number.isSafeInteger(cue.end)||cue.start<previousEnd
        ||cue.end<=cue.start||cue.end>job.snapshot.range.end||typeof cue.text!=='string') throw Error('ASR 结果时间超出目标范围或发生重叠');
      previousEnd=cue.end;
      const result=clone(cue);result.id=`asr-${job.id}-${index}`;result._dirty=true;
      delete result.start_frame;delete result.end_frame;
      for (const item of result.items||[]) {delete item.start_frame;delete item.end_frame;}
      return result;
    });
    if (job.snapshot.mode !== 'whole') {
      const originals = project.segments.filter(cue => job.snapshot.targets.some(target => target.id === cue.id));
      for (const cue of inserted) {
        let source = null, bestOverlap = 0;
        for (const original of originals) {
          const overlap = Math.min(cue.end, original.end) - Math.max(cue.start, original.start);
          if (overlap > bestOverlap) { source = original; bestOverlap = overlap; }
        }
        if (!source) continue;
        const color = source.color || (source.color_ref
          ? {...(project.segments[source.color_ref.headIdx]?.color || {}),
            name:source.color_ref.name || project.segments[source.color_ref.headIdx]?.color?.name} : null);
        // Each replacement owns its inherited color; never leave a reference
        // pointing at a removed group head or stretch color outside the cue.
        delete cue.color_ref;
        if (color) cue.color = {...clone(color), start:cue.start, end:cue.end};
        else delete cue.color;
      }
    }
    const removed=new Set(job.snapshot.targets.map(cue=>cue.id));
    const working=clone(project.segments),cut=new Set();
    working.forEach((cue,index)=>{if(removed.has(cue.id))cut.add(index);});
    if (cut.size&&splitGroups) for (const [head,ref] of [['sticker','sticker_ref'],['color','color_ref']]) splitGroups(cut,head,ref,working,{affectedOnly:true});
    const survivors=working.filter(cue=>!removed.has(cue.id));
    const segments=[...survivors,...inserted].sort((a,b)=>a.start-b.start||a.end-b.end);
    const newIds=new Set(inserted.map(cue=>cue.id));
    let outsideEnd=-1,newEnd=-1;
    for(const cue of segments){
      if(newIds.has(cue.id)){if(cue.start<outsideEnd)throw Error('ASR 结果与目标范围外字幕重叠');newEnd=Math.max(newEnd,cue.end);}
      else{if(cue.start<newEnd)throw Error('ASR 结果与目标范围外字幕重叠');outsideEnd=Math.max(outsideEnd,cue.end);}
    }
    const indices=new Map(segments.map((cue,index)=>[cue.id,index]));
    for (const cue of survivors) for (const key of ['sticker_ref','color_ref']) if(cue[key]) {
      const id=working[cue[key].headIdx]?.id;
      if(indices.has(id))cue[key].headIdx=indices.get(id);else cue[key]=null;
    }
    for (const cue of inserted) for (const key of ['sticker_ref','color_ref']) if(cue[key]) {
      const id=inserted[cue[key].headIdx]?.id;
      if(indices.has(id))cue[key].headIdx=indices.get(id);else cue[key]=null;
    }
    const multi=project.multi_subtitle?clone(project.multi_subtitle):null;
    const stale=clone(project.msw.asr_stale_subtitles||{});
    if(multi) {
      const invalid=(multi.bindings||[]).filter(binding=>binding.main_segment_ids?.some(id=>removed.has(id)));
      multi.bindings=(multi.bindings||[]).filter(binding=>!invalid.includes(binding));
      for(const track of multi.tracks||[]) {
        const linked=new Set(invalid.filter(binding=>binding.track_id===track.id).flatMap(binding=>binding.extension_segment_ids||[]));
        const marks=Object.hasOwn(stale,track.id)?stale[track.id]:{};
        for(const cue of track.segments||[]) if(linked.has(cue.id)||overlaps(cue,job.snapshot.range)) Object.defineProperty(marks,cue.id,{value:job.id,enumerable:true,writable:true,configurable:true});
        if(Object.keys(marks).length)Object.defineProperty(stale,track.id,{value:marks,enumerable:true,writable:true,configurable:true});
      }
      multi._dirty=true;
    }
    const record={source_id:job.snapshot.source.id,source_revision:job.snapshot.source.revision,
      audio_index:job.snapshot.source.audio_index,range:clone(job.snapshot.range),provider:job.provider,model:job.model,
      removed_count:removed.size,added_count:inserted.length};
    const applications=Object.fromEntries([...Object.entries(project.msw.asr_applications||{}),[job.id,record]].slice(-1000));
    const msw={...project.msw,asr_stale_subtitles:stale,asr_applications:applications,
      applied_results:[...(project.msw.applied_results||[]),job.id].slice(-10000)};
    return {applied:true,segments,multi,msw,insertedIds:inserted.map(cue=>cue.id),removedIds:[...removed]};
  }
  function assetStatuses(project) {
    const cues=new Map((project.segments||[]).map(cue=>[JSON.stringify([null,cue.id]),cue]));
    for(const track of project.multi_subtitle?.tracks||[]) for(const cue of track.segments||[])cues.set(JSON.stringify([track.id,cue.id]),cue);
    const statuses=new Map();
    for(const asset of project.msw?.assets||[]) {
      const source=asset.source_ref;
      if(!source||source.kind==='editor_text'||asset.generation?.provider==='imported')continue;
      const cue=cues.get(JSON.stringify([source.track_id??null,source.id]));
      const reason=!cue?'来源字幕已删除或被 ASR 替换':project.msw?.asr_stale_subtitles?.[source.track_id]?.[source.id]
        ?'配音来源副字幕需复核':cue.text!==source.text||cue.start!==source.start||cue.end!==source.end?'来源字幕已修改，配音需复核':'';
      if(reason)statuses.set(asset.id,reason);
    }
    return statuses;
  }
  global.MSWAsr=Object.freeze({canonical,affected,boundaries,snapshot,clipSnapshots,conflict,plan,assetStatuses});
})(window);
