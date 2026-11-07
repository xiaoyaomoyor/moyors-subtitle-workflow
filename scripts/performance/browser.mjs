// Installed only by the benchmark page; never shipped to the editor.
export function installProbe() {
  const p=window.__perf={active:null,longTasks:[],requests:[],errors:[],sequence:0};
  p.observer=new PerformanceObserver(list=>p.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration}))));
  p.observer.observe({type:'longtask',buffered:false});
  const wrap=(obj,key)=>{
    const original=obj?.[key];if(typeof original!=='function')throw Error('Benchmark hook missing: '+key);
    obj[key]=function(...args){const t=performance.now();try{return original.apply(this,args);}finally{if(p.active){const elapsed=performance.now()-t,entry=p.active.calls[key]||={count:0,ms:0};entry.count++;entry.ms+=elapsed;if(key.endsWith('CueDrag'))(entry.samples||=[]).push(elapsed);}}};
  };
  for(const name of ['renderAll','fixedContent','fixedContentKey','fixedAcceptEdit','fixedSyncUI','snapshotSegments','fixedTimingCheckpoint','syncProjectTimebaseAndBindingOffsets','applyCueListDisplaySettings'])wrap(window,name);
  for(const name of ['beginCueDrag','moveCueDrag','endCueDrag'])wrap(waveformEditor,name);
  const request=MSWSubtitleStyle.request;
  MSWSubtitleStyle.request=async function(route,data){
    if(route!=='subtitle-preview')return request.call(this,route,data);
    const row={start:performance.now(),cues:data.project?.subtitles?.cues?.length||0,status:'pending'};p.requests.push(row);
    try {const result=await request.call(this,route,data);row.status='ok';row.assBytes=new TextEncoder().encode(result.ass).length;return result;}
    catch(error){row.status='error';throw error;}finally{row.ms=performance.now()-row.start;}
  };
  const hint=flashHint;window.flashHint=function(message,...args){p.lastHint=message;return hint(message,...args);};
  p.select=(count=1)=>{
    clearSelection({silent:true});const ids=new Set();
    const owner=fixedOwner(DATA.segments[0],'main');
    const sourceIds=new Set(DATA.segments.filter(c=>fixedOwner(c,'main')===owner).map(c=>c.id));
    const pairs=DATA.multi_subtitle.bindings.filter(b=>b.main_segment_ids.some(id=>sourceIds.has(id))).slice(0,count);
    for(const b of pairs)for(const id of [...b.main_segment_ids,...b.extension_segment_ids])ids.add(id);
    if(!pairs.length)for(const c of DATA.segments.slice(0,count))ids.add(c.id);
    DATA.segments.forEach((c,i)=>{if(ids.has(c.id))selectedIdxs.add(i);});
    getActiveExtensionTrack().segments.forEach((c,i)=>{if(ids.has(c.id))selectedExtensionIdxs.add(i);});
    if(ids.size!==(DATA.multi_subtitle.bindings.length?count*2:count))throw Error('Fixture does not contain the requested number of selectable pairs');
    syncCuePanelSelection();return ids.size;
  };
  p.count=()=>DATA.segments.length+getActiveExtensionTrack().segments.length;
  p.begin=()=>{
    p.observer.takeRecords();p.longTasks=[];p.requests=[];p.lastHint='';
    p.active={start:performance.now(),calls:{},frameGaps:[],previewRevision:MSWSubtitleRenderer.revision};
    let previous=p.active.start;
    const frame=now=>{if(!p.active)return;p.active.frameGaps.push(now-previous);previous=now;p.frame=requestAnimationFrame(frame);};
    p.frame=requestAnimationFrame(frame);
  };
  p.end=()=>{
    p.longTasks.push(...p.observer.takeRecords().map(e=>({start:e.startTime,ms:e.duration})));
    const active=p.active,end=performance.now();p.active=null;cancelAnimationFrame(p.frame);
    const tasks=p.longTasks.filter(e=>e.start+e.ms>active.start&&e.start<end);
    return {settledMs:end-active.start,calls:active.calls,frameGaps:active.frameGaps,longTasks:{count:tasks.length,total:tasks.reduce((n,e)=>n+e.ms,0),max:Math.max(0,...tasks.map(e=>e.ms))},previewRequests:p.requests};
  };
  p.action=(name,args={})=>{
    p.actionDone=false;p.actionError=null;p.actionValue=null;
    const t=performance.now();
    try {
      const result=(()=>{
        switch(name){
          case 'select':selectOnly(1,false);return true;
          case 'context-menu':showContextMenu(350,250,0,DATA.segments[0].start+100);return true;
          case 'seek':seekFromWaveform(args.time);return true;
          case 'copy':copySelectedCues();if(!productionClipboard?.rows.length)throw Error('Empty clipboard');return true;
          case 'paste':{const n=p.count(),add=productionClipboard?.rows.length;if(!productionPasteClipboard())throw Error(p.lastHint||'Paste rejected');if(p.count()!==n+add)throw Error('Paste cue count mismatch');return true;}
          case 'cut':{const n=p.count();cutSelectedCues();if(p.count()>=n)throw Error(p.lastHint||'Cut did not change cues');return true;}
          case 'undo':if(!editorHistory.canUndo())throw Error('No undo record');performUndo();return true;
          case 'redo':if(!editorHistory.canRedo())throw Error('No redo record');performRedo();return true;
          case 'split':{
            const n=p.count(),cue=DATA.segments[0],at=cue.items[Math.floor(cue.items.length/2)].start;
            splitFromContextMenu(0,0,0,at);
            if(pendingLinkedSplit)confirmLinkedSplit();
            if(p.count()<=n)throw Error(p.lastHint||'Split not committed');return true;
          }
          case 'merge':{
            const n=p.count(),owner=fixedOwner(DATA.segments[0],'main');
            const ids=DATA.segments.map((c,i)=>({c,i})).filter(({c})=>fixedOwner(c,'main')===owner).slice(0,2).map(r=>r.i);
            if(!mergeSegments(ids)||p.count()>=n)throw Error(p.lastHint||'Merge not committed');return true;
          }
          case 'text':cuePanelText.value=args.text;cuePanelText.dispatchEvent(new Event('input',{bubbles:true}));commitCuePanelEdit();return true;
          case 'style':{
            const before=editorHistory.undoLength();
            const el=document.getElementById('style-project-preset');el.value='large';el.dispatchEvent(new Event('change',{bubbles:true}));
            if(editorHistory.undoLength()!==before+1)throw Error('Style did not create exactly one history record');return true;
          }
          case 'save':return saveProjectToServer({silent:true});
          case 'draft':return MSWE.resolve('project-persistence').captureDraft({force:true});
          case 'search':{const el=document.getElementById('find-edit-query');el.value='reproducible';el.dispatchEvent(new Event('input',{bubbles:true}));return true;}
          case 'idle':return true;
          default:throw Error('Unknown benchmark action: '+name);
        }
      })();
      const syncMs=performance.now()-t;
      Promise.resolve(result).then(value=>{p.actionValue=value;p.actionDone=true;},error=>{p.actionError=String(error.message);p.actionDone=true;});
      return {syncMs};
    }catch(error){p.actionError=String(error.message);p.actionDone=true;return {syncMs:performance.now()-t};}
  };
  p.paint=async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-p.active.start;};
  p.snapshot=()=>MSWProductionProject.toProject(DATA);
}

export async function measure(page,name,args={},options={}) {
  await page.evaluate(()=>__perf.begin());
  let sample={status:'ok'};
  try {
    Object.assign(sample,await page.evaluate(({name,args})=>__perf.action(name,args),{name,args}));
    sample.feedbackMs=await page.evaluate(()=>__perf.paint());
    await page.waitForFunction(()=>__perf.actionDone,null,{timeout:options.timeout||90000});
    const result=await page.evaluate(()=>({error:__perf.actionError,value:__perf.actionValue}));
    if(result.error||result.value===false)throw Error(result.error||'Operation returned false');
    if(options.preview)await page.waitForFunction(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending&&MSWSubtitleRenderer.revision>__perf.active.previewRevision,null,{timeout:options.timeout||90000});
    if(options.search)await page.waitForFunction(count=>document.getElementById('find-edit-count').textContent.startsWith(`${count} 条`),options.searchCount,{timeout:options.timeout||90000});
    if(options.idleMs)await page.waitForTimeout(options.idleMs);
  }catch(error){sample.status='failed';sample.error=error.message;}
  Object.assign(sample,await page.evaluate(()=>__perf.end()));
  return sample;
}

export async function ready(page) {
  await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&player.readyState>=2&&waveformEditor?.peaks?.length>0,null,{timeout:120000});
  await page.waitForFunction(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending&&!projectSaveInFlight&&!projectCheckpointInFlight,null,{timeout:120000});
}

export async function memory(cdp,label) {
  const before=await cdp.send('Runtime.getHeapUsage');
  await cdp.send('HeapProfiler.collectGarbage');
  const after=await cdp.send('Runtime.getHeapUsage'),dom=await cdp.send('Memory.getDOMCounters');
  return {label,heapBeforeGC:before,heapAfterGC:after,dom};
}
