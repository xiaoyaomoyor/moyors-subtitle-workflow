// Opt-in local benchmark. The supplied project is read only; all writes and
// server settings stay under the explicitly selected output directory.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';
import {findFreePort,startServer,disableOnboarding} from '../tests/e2e/helpers.mjs';
const [input,output]=process.argv.slice(2);
const verifyOnly=process.argv.includes('--verify-only');
if(!input||!output)throw Error('Usage: node scripts/benchmark_bound_subtitles.mjs PROJECT.mosp OUTPUT_DIRECTORY');
const dir=resolve(output),file=resolve(dir,'test.mosp');
if(file===resolve(input))throw Error('Benchmark output must not overwrite the input');
mkdirSync(dir,{recursive:true});
const project=JSON.parse(readFileSync(input,'utf8'));project.media=resolve(dirname(resolve(input)),project.media);
const [main,sub]=project.subtitles.tracks,next=Math.max(...project.subtitles.tracks.map(t=>t.display_number))+1;
project.subtitles.tracks.push({...structuredClone(main),id:'perf-dest',display_number:next},
  {...structuredClone(sub),id:'perf-dest-sub',secondary_for:'perf-dest',display_number:next});project.subtitles.next_track_number=next+1;
writeFileSync(file,JSON.stringify(project));
process.env.MSW_APP_DATA_ROOT=resolve(dir,'settings');process.env.MAW_ENV_FILE=resolve(dir,'isolated.env');
const server=await startServer(file,project.media,await findFreePort());
const browser=await chromium.launch({headless:true,...(process.env.MSW_E2E_CHROMIUM_PATH?{executablePath:process.env.MSW_E2E_CHROMIUM_PATH}:{})});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());await disableOnboarding(page);
  await page.goto(server.url,{timeout:120000});
  await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&player.readyState>=2&&waveformEditor?.peaks?.length>0,null,{timeout:90000});
  await page.evaluate(()=>{
    updateEditorSettings({autoSaveProject:false,selectBoundSubtitlePair:false,clickBehavior:'select-only'});player.pause();
    waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=10;waveformEditor.settings.rowHeight=220;
    waveformEditor.render();seekFromWaveform(DATA.segments[0].start/1000+.1);
    window.perfSamples=[];window.perfDetails=[];window.perfActive='';
    for(const name of ['renderAll','fixedContent','fixedContentKey','fixedAcceptEdit','fixedTimingCheckpoint','fixedFinishDragTransaction','fixedSyncUI','snapshotSegments','syncProjectTimebaseAndBindingOffsets','applyCueListDisplaySettings']) {
      const fn=window[name];window[name]=function(...args){const t=performance.now();try{return fn.apply(this,args);}finally{if(perfActive)perfDetails.push({op:perfActive,name,ms:performance.now()-t});}};
    }
    for(const name of ['beginCueDrag','moveCueDrag','endCueDrag']) {
      const fn=waveformEditor[name];waveformEditor[name]=function(...args){const t=performance.now();try{return fn.apply(this,args);}finally{perfSamples.push({name,ms:performance.now()-t});}};
    }
    window.perfMeasure=(name,fn)=>{perfActive=name;const t=performance.now();try{return fn();}finally{perfSamples.push({name,ms:performance.now()-t});perfActive='';}};
    window.perfSelect=n=>{clearSelection({silent:true});const bindings=DATA.multi_subtitle.bindings.slice(0,n),ids=new Set(bindings.flatMap(b=>[...b.main_segment_ids,...b.extension_segment_ids]));
      DATA.segments.forEach((c,i)=>{if(ids.has(c.id))selectedIdxs.add(i);});getActiveExtensionTrack().segments.forEach((c,i)=>{if(ids.has(c.id))selectedExtensionIdxs.add(i);});syncCuePanelSelection();};
    const hint=window.flashHint;window.flashHint=function(message,...args){window.perfLastHint=message;return hint(message,...args);};
  });
  await page.waitForFunction(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending,null,{timeout:30000}).catch(async error=>{
    console.log(JSON.stringify(await page.evaluate(()=>({errors:document.querySelector('#subtitle-render-status')?.textContent,status:MSWSubtitleRenderer.status,pending:MSWSubtitleRenderer.pending,trace:MSWSubtitleRenderer.diagnostics,media:[player.currentSrc,player.readyState,player.currentTime]})),null,2));throw error;
  });
  const metadata=await page.evaluate(()=>({cues:DATA.segments.length+getActiveExtensionTrack().segments.length,peakPairs:waveformEditor.peaks.length/2,
    bindings:DATA.multi_subtitle.bindings.length,viewport:[innerWidth,innerHeight],renderer:MSWSubtitleRenderer.status}));
  const history=[];
  for(const count of verifyOnly?[]:[1,100])for(let run=0;run<3;run++) {
    const result=await page.evaluate(({count,run})=>{
      perfSelect(count);fixedActiveTrackId='perf-dest';waveformEditor.pointerLineRow=null;player.currentTime=DATA.segments[0].start/1000;
      perfMeasure('copy-'+count,copySelectedCues);
      const okay=perfMeasure('paste-'+count,productionPasteClipboard);if(!okay)throw Error('Paste failed: '+window.perfLastHint);
      const record=editorHistory.peekUndo(),bytes=new TextEncoder().encode(JSON.stringify(record)).length;
      perfMeasure('undo-'+count,performUndo);perfMeasure('redo-'+count,performRedo);performUndo();
      return {count,run,kind:record.kind,bytes};
    },{count,run});history.push(result);
    await page.waitForFunction(()=>!MSWSubtitleRenderer.pending,null,{timeout:90000});
  }
  await page.evaluate(()=>{perfSelect(DATA.segments.length);perfMeasure('copy-all',copySelectedCues);perfSelect(1);waveformEditor.scroll.scrollTop=0;waveformEditor.renderMultiVisible(true);});
  const block=page.locator('.waveform-cue-block[data-track="main"][data-idx="0"]').first();await block.scrollIntoViewIfNeeded();
  for(let run=0;run<(verifyOnly?0:3);run++) {
    const box=await block.boundingBox(),target=await page.evaluate(()=>{
      const row=document.querySelector('.waveform-row'),r=row.getBoundingClientRect(),lane=fixedLayout().positions.get(JSON.stringify(['perf-dest','main']));
      return r.bottom-7-(parseFloat(row.style.getPropertyValue('--audio-lane-space'))||0)-lane*waveformEditor.subtitleGeometry().pitch-waveformEditor.subtitleGeometry().height/2;
    });
    const x=box.x+Math.min(box.width/2,90),y=box.y+box.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+25,target,{steps:12});
    await page.evaluate(()=>perfActive='drag-end');await page.mouse.up();
    history.push(await page.evaluate(()=>{perfActive='';const r=editorHistory.peekUndo();return {count:1,kind:r.kind,bytes:new TextEncoder().encode(JSON.stringify(r)).length};}));
    await page.evaluate(()=>perfMeasure('undo-drag',performUndo));
  }
  const result=await page.evaluate(()=>({samples:perfSamples,details:perfDetails}));Object.assign(result,{metadata,history,errors});
  writeFileSync(resolve(dir,'metrics.json'),JSON.stringify(result,null,2));
  const summary={};for(const name of new Set(result.samples.map(s=>s.name))){const values=result.samples.filter(s=>s.name===name).map(s=>s.ms).sort((a,b)=>a-b);summary[name]={n:values.length,median:values[Math.floor(values.length/2)],max:values.at(-1)};}
  console.log(JSON.stringify({metadata,summary,history,errors},null,2));
  if(verifyOnly||process.argv.includes('--verify')) {
    console.log('Verifying selection, locks, conflicts and persistence');
    const verified=await page.evaluate(()=>{
      const snapshot=()=>JSON.parse(buildJson()).subtitles,before=snapshot(),check=(value,label)=>{if(!value)throw Error(label);};
      perfSelect(100);copySelectedCues();fixedActiveTrackId='perf-dest-sub';waveformEditor.pointerLineRow=null;
      player.currentTime=0;
      fixedUpdateTrack('perf-dest-sub',{locked:true});fixedActiveTrackId='perf-dest';const locked=JSON.stringify(snapshot()),undo=editorHistory.peekUndo();
      check(!productionPasteClipboard(),'Locked destination accepted');check(JSON.stringify(snapshot())===locked&&editorHistory.peekUndo()===undo,'Rejected paste mutated state/history');performUndo();
      fixedUpdateTrack('perf-dest-sub',{collapsed:true});fixedActiveTrackId='perf-dest-sub';
      check(productionPasteClipboard(),'Paste to collapsed destination failed: '+window.perfLastHint);const after=snapshot(),ids=processingSelection();
      check(ids.mainIds.length===100&&ids.extensionIds.length===100,'Wrong pasted selection');
      const oldIds=new Set(before.cues.map(c=>c.id)),added=after.cues.filter(c=>!oldIds.has(c.id));
      check(added.length===200&&after.bindings.length===before.bindings.length+100,'Incomplete pair insertion');
      check(new Set(after.cues.map(c=>c.id)).size===after.cues.length,'Duplicate IDs');
      const fields=c=>JSON.stringify(c);check(after.cues.filter(c=>oldIds.has(c.id)).every(c=>fields(c)===fields(before.cues.find(a=>a.id===c.id))),'Original cue changed');
      const stable=JSON.stringify(after),history=editorHistory.peekUndo();fixedActiveTrackId='perf-dest';
      check(!productionPasteClipboard(),'Overlapping paste accepted');check(JSON.stringify(snapshot())===stable&&editorHistory.peekUndo()===history,'Conflict mutated state/history');
      performUndo();check(snapshot().cues.length===before.cues.length,'Undo left additions');performRedo();check(JSON.stringify(snapshot())===stable,'Redo did not restore identities');
      // Re-expand for visual inspection; this also interleaves full and local history.
      fixedUpdateTrack('perf-dest-sub',{collapsed:false});
      return {checks:['100 pairs selected','locked destination atomic','collapsed target mapping','collision atomic','original cues unchanged','undo/redo identities'],addedIds:added.map(c=>c.id)};
    });
    await page.evaluate(()=>{clearSelection();player.currentTime=1;MSWSubtitleRenderer.invalidate();});
    await page.waitForFunction(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending,null,{timeout:90000});
    const previewBefore=await page.evaluate(async()=>({events:await MSWSubtitleRenderer.renderer.renderer.getEvents(),styles:await MSWSubtitleRenderer.renderer.renderer.getStyles(),geometry:MSWSubtitleRenderer.geometry}));
    await page.locator('.player-stage').screenshot({path:resolve(dir,'preview-before-reopen.png')});
    await page.waitForFunction(()=>!projectSaveInFlight&&!projectCheckpointInFlight,null,{timeout:90000});
    const saveStart=Date.now(),saveResult=await page.evaluate(async()=>{
      let error='';const show=showProjectSaveError;showProjectSaveError=value=>{error=String(value);show(value);};
      try{return {ok:await saveProjectToServer({silent:true}),error};}finally{showProjectSaveError=show;}
    });assert.equal(saveResult.ok,true,saveResult.error);verified.saveMs=Date.now()-saveStart;
    const saved=await page.evaluate(()=>JSON.parse(buildJson()));writeFileSync(resolve(dir,'expected.json'),JSON.stringify(saved));
    const model=value=>JSON.parse(JSON.stringify(value,(key,v)=>key.startsWith('_')?undefined:v));
    const disk=JSON.parse(readFileSync(file,'utf8'));assert.deepEqual(model(disk.subtitles),model(saved.subtitles));
    await page.reload({timeout:120000});await page.waitForFunction(()=>MSWSubtitleStyle.ready&&player.readyState>=2,null,{timeout:90000});
    assert.deepEqual(model(await page.evaluate(()=>JSON.parse(buildJson()).subtitles)),model(saved.subtitles));
    await page.evaluate(()=>{player.pause();player.currentTime=1;MSWSubtitleRenderer.invalidate();});
    await page.waitForFunction(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending,null,{timeout:90000});
    const previewAfter=await page.evaluate(async()=>({events:await MSWSubtitleRenderer.renderer.renderer.getEvents(),styles:await MSWSubtitleRenderer.renderer.renderer.getStyles(),geometry:MSWSubtitleRenderer.geometry}));
    assert.deepEqual(previewAfter,previewBefore);
    await page.locator('.player-stage').screenshot({path:resolve(dir,'preview-after-reopen.png')});
    verified.checks.push('server save on disk','reopen data equality','libass events/styles/geometry equality');verified.errors=errors;
    writeFileSync(resolve(dir,'verification.json'),JSON.stringify(verified,null,2));console.log(JSON.stringify({checks:verified.checks,saveMs:verified.saveMs,errors},null,2));
  }
} finally {await browser.close();await server.stop();}
