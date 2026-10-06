// Result application is planned on a copy, then committed as one editor undo step.
(function (global) {
  'use strict';
  const copy = v => global.MSWProject.clone(v);
  const clean = v => global.MSWAsr.canonical(v);
  const same = (a,b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));
  const overlap = (a,b) => a.start < b.end && b.start < a.end;
  const affected = (cues,ranges) => cues.filter(c => ranges.some(r => overlap(c,r)));
  const unique = cues => [...new Map(cues.map(c => [c.id,c])).values()].sort((a,b) => a.start-b.start || a.end-b.end);
  const layered = project => project.schema === 'msw.project.v2';
  function targetChoices(project,jobs,target) {
    const cues = target === 'main' ? project.segments : project.multi_subtitle?.tracks?.[0]?.segments || [];
    const rows = unique(affected(cues,jobs.map(j=>j.snapshot.range))).filter(c=>!(target==='main'&&layered(project)&&project.subtitle_layers?.legacy_overlay?.visible===false&&project.subtitle_layers.legacy_overlay.cue_ids.includes(c.id)));
    let end = -1, ambiguous = false;
    for (const cue of rows) { if (cue.start < end) ambiguous = true; end = Math.max(end,cue.end); }
    return {rows,required:layered(project)&&ambiguous};
  }
  function crossing(project,jobs,target) {
    const cues = target === 'main' ? project.segments : project.multi_subtitle?.tracks?.[0]?.segments || [];
    const ranges = union(jobs.map(j => j.snapshot.range));
    return affected(cues,ranges).some(c => !ranges.some(r => c.start >= r.start && c.end <= r.end));
  }
  function union(ranges) {
    const result=[];
    for (const r of [...ranges].sort((a,b) => a.start-b.start)) {
      const last=result.at(-1);
      if(last && r.start <= last.end) last.end=Math.max(last.end,r.end);
      else result.push({...r});
    }
    return result;
  }
  function sourceGuard(project,media,job) {
    const snap=job.snapshot;
    // Reuse source version checking independently of target subtitle edits.
    const probe={...project,segments:copy(snap.targets)};
    const issue=global.MSWAsr.conflict(probe,media,snap);
    if(issue && !issue.includes('切穿')) throw Error(issue);
  }
  function ownStyles(cue,all) {
    const result=copy(cue);
    for(const [head,ref] of [['color','color_ref'],['sticker','sticker_ref']]) {
      const style=cue[head] || all[cue[ref]?.headIdx]?.[head];
      delete result[ref];
      if(style) result[head]={...copy(style),start:cue.start,end:cue.end};
    }
    return result;
  }
  function remainder(cue,span,id) {
    const result={...copy(cue),...span,id,_dirty:true};
    delete result.start_frame; delete result.end_frame;
    const items=cue.items;
    const reliable=items?.length && items.every(i => Number.isSafeInteger(i.start) && Number.isSafeInteger(i.end)
      && i.start >= cue.start && i.end <= cue.end && i.end > i.start && typeof i.text === 'string')
      && items.every((i,n) => !n || i.start >= items[n-1].end)
      && items.map(i => i.text).join('').replace(/\s/g,'') === cue.text.replace(/\s/g,'')
      && !items.some(i => (i.start < span.start && i.end > span.start) || (i.start < span.end && i.end > span.end));
    if(reliable) {
      result.items=items.filter(i => i.start >= span.start && i.end <= span.end).map(copy);
      result.text=result.items.map(i => i.text).join('');
      if(!result.text.trim()) return null;
    } else {delete result.items;result.review_required=true;}
    for(const field of ['color','sticker']) if(result[field]) Object.assign(result[field],span);
    return result;
  }
  function asr(project,media,jobs,target,strategy,previous,{targetIds}={}) {
    jobs.forEach(j => sourceGuard(project,media,j));
    const ranges=union(jobs.map(j => j.snapshot.range));
    const multi=project.multi_subtitle ||= {schema:'moy.asr.multi_subtitle.v1',enabled:false,display_mode:'both',tracks:[],bindings:[]};
    const track=multi.tracks[0];
    const old=target==='main' ? project.segments : track?.segments || [];
    const trackId=target==='main' ? null : track?.id || null;
    if(target==='secondary' && jobs.some(j => !j.snapshot.secondary) && !previous) throw Error('旧识别记录没有副轨快照，请重新识别或存入素材库');
    const originals=unique(jobs.flatMap(j => target==='main' ? j.snapshot.targets : j.snapshot.secondary.targets));
    const priorRanges=previous?.state.ranges || (previous ? ranges : []);
    const guardRanges=union([...ranges,...priorRanges,...originals.map(c=>({start:c.start,end:c.end}))]);
    const expected={track_id:previous?.state.track_id ?? (target==='main' ? null : jobs[0].snapshot.secondary.track_id),
      targets:unique([...(previous?.state.targets||[]),...originals.filter(c=>!priorRanges.some(r=>overlap(c,r)))])};
    if (layered(project)) {
      if (!previous && targetIds === undefined && targetChoices(project,jobs,target).required) {
        const error=Error('此范围包含重叠字幕，请选择本次替换的目标');error.code='choose-targets';throw error;
      }
      const ids=previous?.state.target_ids ? [...new Set([...previous.state.target_ids,...originals.filter(c=>!priorRanges.some(r=>overlap(c,r))).map(c=>c.id)])] : targetIds || originals.map(c=>c.id);
      if (!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!expected.targets.some(c=>c.id===id))) throw Error('替换目标不属于识别时的字幕快照');
      expected.targets=expected.targets.filter(c=>ids.includes(c.id));
      if(trackId!==expected.track_id || !same(unique(old.filter(c=>ids.includes(c.id))),unique(expected.targets))) throw Error('所选目标字幕已变化，请重新识别或存入素材库');
    } else if(trackId !== expected.track_id || !same(unique(affected(old,guardRanges)),unique(expected.targets))) throw Error('目标范围内字幕已变化，请重新识别或存入素材库');
    const targetSet=new Set(expected.targets.map(c=>c.id));
    if(expected.targets.some(c=>ranges.some(r=>overlap(c,r))&&!ranges.some(r=>c.start>=r.start&&c.end<=r.end)) && !['whole','trim'].includes(strategy)) throw Error('请选择整条替换或截断保留');
    const groups=new Map();
    function remember(cue, original, all, origin) {
      const refs={};
      for(const [head,ref] of [['color','color_ref'],['sticker','sticker_ref']]) {
        const index=original[head]?all.indexOf(original):original[ref]?.headIdx;
        if(Number.isInteger(index))refs[head]=`${origin}:${head}:${index}`;
      }
      groups.set(cue.id,refs);
    }
    const inserted=jobs.flatMap(job => {
      let end=job.snapshot.range.start;
      return job.result.segments.map((c,i,all) => {
        if(!Number.isSafeInteger(c.start)||!Number.isSafeInteger(c.end)||c.start<job.snapshot.range.start||(!layered(project)&&c.start<end)||c.end<=c.start||c.end>job.snapshot.range.end||!c.text?.trim()) throw Error('候选字幕为空、时间无效或重叠');
        end=c.end;
        const cue=ownStyles(c,all);cue.id=`asr-${job.id}-${target}-${i}`;cue._dirty=true;
        remember(cue,c,all,job.id);
        delete cue.start_frame;delete cue.end_frame;
        const originals=affected(old.filter(c=>!layered(project)||targetSet.has(c.id)),[cue]);
        const original=originals.sort((a,b) => (Math.min(cue.end,b.end)-Math.max(cue.start,b.start))-(Math.min(cue.end,a.end)-Math.max(cue.start,a.start)))[0];
        if(original && job.snapshot.mode!=='whole') {
          const color=ownStyles(original,old).color;
          delete cue.color;
          if(color) cue.color={...color,start:cue.start,end:cue.end};
          delete groups.get(cue.id).color;
        }
        return cue;
      });
    }).sort((a,b) => a.start-b.start || a.end-b.end);
    if(!inserted.length) throw Error('没有识别到语音；保留现有字幕');
    for(let i=1;!layered(project)&&i<inserted.length;i++) if(inserted[i].start<inserted[i-1].end) throw Error('同批候选字幕彼此重叠，请先存入素材库整理');
    const removed=new Set(affected(old,ranges).filter(c=>!layered(project)||targetSet.has(c.id)).map(c => c.id)), survivors=[];
    old.forEach((c,index) => {
      const cue=ownStyles(c,old);
      remember(cue,c,old,'original');
      if(!removed.has(c.id)) {survivors.push(cue);return;}
      if(strategy!=='trim') return;
      let spans=[{start:c.start,end:c.end}];
      for(const r of ranges) spans=spans.flatMap(s => !overlap(s,r) ? [s] : [
        s.start<r.start ? {start:s.start,end:r.start}:null,s.end>r.end ? {start:r.end,end:s.end}:null].filter(Boolean));
      spans.forEach((span,n) => {const piece=remainder(cue,span,`remain-${jobs[0].id}-${target}-${index}-${n}`);if(piece)survivors.push(piece);});
    });
    const result=[...survivors,...inserted].sort((a,b) => a.start-b.start || a.end-b.end);
    const newIds=new Set(inserted.map(c => c.id));
    for(let i=1;!layered(project)&&i<result.length;i++) if((newIds.has(result[i].id)||newIds.has(result[i-1].id)) && result[i].start<result[i-1].end) throw Error('结果与范围外字幕重叠');
    if(layered(project)&&project.subtitle_layers?.allow_overlap===false) {
      for(const cue of inserted) {
        if(inserted.some(other=>other!==cue&&overlap(cue,other)) || survivors.some(other=>overlap(cue,other)
            && !old.some(source=>targetSet.has(source.id)&&overlap(source,other)))) {
          throw Error('此操作会新增字幕重叠，请先启用“允许字幕重叠”');
        }
      }
    }
    const heads=new Map();
    result.forEach((cue,index)=>{
      for(const field of ['color','sticker']) {
        const group=groups.get(cue.id)?.[field];if(!group||!cue[field])continue;
        if(!heads.has(group))heads.set(group,index);
        else {
          const head=heads.get(group),style=result[head][field];style.end=Math.max(style.end,cue.end);
          cue[`${field}_ref`]={headIdx:head,...(style.name?{name:style.name}:{})};delete cue[field];
        }
      }
    });
    if(target==='main') {
      project.segments=result;
      const invalidBindings=multi.bindings.filter(b=>b.main_segment_ids.some(id=>removed.has(id)));
      project.msw.asr_stale_subtitles ||= {};
      for(const t of multi.tracks) {
        const stale=project.msw.asr_stale_subtitles;
        if(!Object.hasOwn(stale,t.id))Object.defineProperty(stale,t.id,{value:{},enumerable:true,writable:true,configurable:true});
        const marks=stale[t.id];
        const linked=new Set(invalidBindings.filter(b=>b.track_id===t.id).flatMap(b=>b.extension_segment_ids));
        for(const cue of t.segments.filter(c=>linked.has(c.id)||(!layered(project)&&ranges.some(r=>overlap(c,r)))))Object.defineProperty(marks,cue.id,{value:jobs[0].id,enumerable:true,writable:true,configurable:true});
      }
      multi.bindings=multi.bindings.filter(b => !b.main_segment_ids.some(id => removed.has(id)));
    } else {
      const dest=track || {id:global.MSWProject.id('extension'),role:'extension',name:'副字幕',language:'',split_mode:'continuous',source_name:'ASR',segments:[]};
      dest.segments=result;if(!track)multi.tracks.push(dest);
      multi.enabled=true;
      multi.bindings=multi.bindings.filter(b => b.track_id!==dest.id || !b.extension_segment_ids.some(id => removed.has(id)));
      for(const cue of inserted) {
        const matches=project.segments.filter(c => c.start===cue.start&&c.end===cue.end);
        if(matches.length===1 && !multi.bindings.some(b => b.main_segment_ids.includes(matches[0].id))) multi.bindings.push({
          id:global.MSWProject.id('binding'),track_id:dest.id,main_segment_ids:[matches[0].id],extension_segment_ids:[cue.id],start_offset_ms:0,end_offset_ms:0});
        if(Object.hasOwn(project.msw.asr_stale_subtitles||{},dest.id))delete project.msw.asr_stale_subtitles[dest.id][cue.id];
      }
    }
    multi._dirty=true;
    const target_ids=result.filter(c=>newIds.has(c.id)||targetSet.has(c.id)||!old.some(o=>o.id===c.id)).map(c=>c.id);
    return {track_id:target==='main'?null:multi.tracks[0].id,targets:copy(layered(project)?result.filter(c=>target_ids.includes(c.id)):affected(result,guardRanges)),ranges:guardRanges,
      ...(layered(project)?{target_ids}: {})};
  }
  function translation(project,jobs,target,batch) {
    const job=jobs[0], input=copy(job.snapshot), result=job.result;
    const lastMain=batch.applications.main?.state, lastSecondary=batch.applications.secondary?.state;
    // Only our own last writes may advance a baseline. User changes still conflict.
    if(lastMain) for(const entry of input.entries) {
      const last=lastMain.sources?.find(c => c.id===entry.source.id);
      if(last) entry.source=copy(last);
    }
    if(lastSecondary) {
      input.track_id=lastSecondary.snapshot.track_id;
      input.entries.forEach(e => {
        const last=lastSecondary.snapshot.entries.find(x => x.source.id===e.source.id);
        if(last) {e.target=copy(last.target);e.binding_id=last.binding_id;}
      });
    }
    input.output_mode=target==='main'?'replace_main':'secondary';
    // Preserved original-language rows are candidates too, especially when writing another track.
    const plan=global.MSWTranslation.reconcile(project,input,{...result,skipped_ids:[],skipped_id_namespace:'project'});
    if(plan.conflicts.length) throw Error(plan.conflicts.map(c => `${c.id}：${c.reason}`).join('；'));
    if(plan.segments)project.segments=plan.segments;
    if(plan.multi)project.multi_subtitle=plan.multi;
    if(target==='secondary'&&plan.multi) {
      const track=plan.multi.tracks[0];
      if(track&&Object.hasOwn(project.msw.asr_stale_subtitles||{},track.id)) {
        const applied=new Set(plan.appliedIds);
        for(const binding of plan.multi.bindings.filter(b=>b.track_id===track.id&&b.main_segment_ids.some(id=>applied.has(id)))) {
          for(const id of binding.extension_segment_ids)delete project.msw.asr_stale_subtitles[track.id][id];
        }
      }
      for(const entry of input.entries.filter(e=>!e.target)) {
        const binding=plan.multi.bindings.find(b=>b.main_segment_ids.includes(entry.source.id));
        const cue=track.segments.find(c=>binding?.extension_segment_ids.includes(c.id));
        const source=project.segments.find(c=>c.id===entry.source.id);
        const color=source&&ownStyles(source,project.segments).color;
        if(cue&&color)cue.color={...copy(color),start:cue.start,end:cue.end};
      }
    }
    const selection={mainIds:input.entries.map(e => e.source.id),hasSelection:true};
    return {sources:input.entries.map(e => copy(project.segments.find(c => c.id===e.source.id))),snapshot:global.MSWTranslation.snapshot(project,selection)};
  }
  function plan(source,media,jobs,target,strategy,options={}) {
    if(!['main','secondary'].includes(target)||!jobs.length||jobs.some(j => j.status!=='succeeded'||j.project_id!==source.msw.project_id)) throw Error('候选结果不属于当前工程或尚未完成');
    // Waveform/spectral caches can be very large and are not part of this transaction.
    const project={...source,segments:copy(source.segments),multi_subtitle:copy(source.multi_subtitle),msw:copy(source.msw)},batch=global.MSWResults.record(project.msw,jobs[0]);
    const revision=global.MSWResults.revision(jobs), previous=batch.applications[target];
    if(previous?.revision===revision) return {duplicate:true};
    if(!previous && !batch.edits.length && jobs.every(j=>project.msw.applied_results?.includes(j.id)
      && (j.kind==='asr' ? target==='main' : target===(j.snapshot.output_mode==='replace_main'?'main':'secondary'))))return {duplicate:true};
    const state=jobs[0].kind==='asr' ? asr(project,media,jobs,target,strategy,previous,options) : translation(project,jobs,target,batch);
    batch.applications[target]={revision,state};
    return {project,count:jobs.reduce((n,j) => n+global.MSWResults.rows(j).length,0)};
  }
  function captureState(project,jobs,target) {
    const application=global.MSWResults.record(project.msw,jobs[0]).applications[target];
    if(jobs[0].kind==='asr') {
      const cues=target==='main'?project.segments:project.multi_subtitle.tracks[0].segments;
      application.state.targets=copy(layered(project)?cues.filter(c=>application.state.target_ids.includes(c.id)):affected(cues,application.state.ranges));
    } else {
      const ids=jobs[0].snapshot.entries.map(e=>e.source.id);
      application.state.sources=copy(project.segments.filter(c=>ids.includes(c.id)));
      application.state.snapshot=global.MSWTranslation.snapshot(project,{mainIds:ids,hasSelection:true});
    }
  }
  global.MSWResultApply=Object.freeze({plan,crossing,union,captureState,targetChoices});
})(window);
