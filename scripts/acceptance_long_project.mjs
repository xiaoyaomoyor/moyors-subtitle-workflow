#!/usr/bin/env node
// Opt-in sustained editing/playback acceptance. Synthetic data only; no cloud.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync,existsSync,writeFileSync,readFileSync,statSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createFixture,waveform,audioFixture,hash,DURATION_MS} from './performance/fixtures.mjs';
import {installProbe,ready,memory} from './performance/browser.mjs';

const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const minutes=Number(option('--minutes','120'));
const startCycle=Number(option('--start-cycle','0')),playbackSeconds=Number(option('--playback-seconds','15'));
assert(Number.isFinite(minutes)&&minutes>0&&minutes<=480);
assert(Number.isInteger(startCycle)&&startCycle>=0&&playbackSeconds>0);
const root=resolve(option('--out',`output/long-acceptance-${Date.now()}`));
assert(!existsSync(root),'Use a new output directory');mkdirSync(root,{recursive:true});
if(!process.env.MSW_E2E_PYTHON&&existsSync('.venv/Scripts/python.exe'))process.env.MSW_E2E_PYTHON=resolve('.venv/Scripts/python.exe');
process.env.MSW_ENV_FILE=join(root,'isolated.env');process.env.MAW_ENV_FILE=process.env.MSW_ENV_FILE;
process.env.MSW_APP_DATA_ROOT=join(root,'settings');
const {startServer,findFreePort,disableOnboarding}=await import('../tests/e2e/helpers.mjs');
const media=join(root,'synthetic.mp4'),working=join(root,'working.mosp');
const ffmpeg=process.env.MSW_E2E_FFMPEG||'ffmpeg';
execFileSync(ffmpeg,['-v','error','-f','lavfi','-i',`color=black:s=640x360:r=2:d=${DURATION_MS/1000}`,'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',media],{windowsHide:true});
const {project,manifest}=createFixture('mixed',10000);project.media='synthetic.mp4';project.waveform=waveform();
const st=statSync(media);project.waveform.source={name:'synthetic.mp4',size:st.size,modified_ms:Math.floor(st.mtimeMs)};
writeFileSync(working,JSON.stringify(project));
for(const asset of project.msw.assets){const p=join(root,asset.path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,audioFixture());}
const files=execFileSync('rg',['--files','web','maw','server-editor'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/).filter(f=>/\.(js|py|css|html)$/.test(f)).sort();
const digest=()=>hash(files.map(f=>readFileSync(f,'utf8').replaceAll('\r\n','\n')));
const report={schema:'msw.long-acceptance.v1',status:'running',started:new Date().toISOString(),minutes,startCycle,playbackSeconds,sourceHash:digest(),fixture:manifest,cycles:[],memory:[],errors:[],requestFailures:[]};
const persist=()=>writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');
const clean=value=>{
  const result=JSON.parse(JSON.stringify(value,(k,v)=>k.startsWith('_')?undefined:v));
  // Undo materializes the optional empty tombstone list. Its meaning is the
  // same as absence; nonempty tombstones must still compare exactly.
  if(result.msw)result.msw.removed_asset_ids ||= [];
  return result;
};
let server,browser,page;
try {
  server=await startServer(working,media,await findFreePort());browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});page=await context.newPage();
  page.on('response',async response=>{if(response.status()>=400){let body='';try{body=(await response.text()).slice(0,2000);}catch{}report.requestFailures.push({path:new URL(response.url()).pathname,status:response.status(),body});}});
  page.on('requestfailed',request=>report.requestFailures.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText}));
  await context.route('**/*',r=>{const u=new URL(r.request().url());return /^https?:$/.test(u.protocol)&&!['127.0.0.1','localhost'].includes(u.hostname)?r.abort():r.continue();});
  page.on('pageerror',e=>report.errors.push(e.message));page.on('crash',()=>report.errors.push('Page crashed'));
  await disableOnboarding(page);await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:120000});await ready(page);
  report.saveSetup=await page.evaluate(()=>{
    const before={enabled:EDITOR_SETTINGS.autoSaveProject,timer: autoSaveTimer!==null};
    updateEditorSettings({selectBoundSubtitlePair:false,clickBehavior:'select-only'});
    // Use the user-facing change handler: changing only the settings object
    // leaves the already-created interval alive and races the test's save.
    autoSaveProjectToggle.checked=false;autoSaveProjectToggle.dispatchEvent(new Event('change',{bubbles:true}));
    seekFromWaveform(.1);
    return {before,after:{enabled:EDITOR_SETTINGS.autoSaveProject,timer:autoSaveTimer!==null}};
  });assert.deepEqual(report.saveSetup.after,{enabled:false,timer:false});await ready(page);await page.evaluate(installProbe);
  const cdp=await context.newCDPSession(page),before=clean(await page.evaluate(()=>__perf.snapshot()));
  const baselineFonts=await page.evaluate(async()=>(await MSWSubtitleRenderer.renderer.renderer.getStyles()).map(s=>[s.Name,s.FontSize]).sort());
  const checkModel=async()=>{
    const after=clean(await page.evaluate(()=>__perf.snapshot()));
    for(const key of ['subtitles','msw'])assert.deepEqual(after[key],before[key],key+' changed after undo');
    assert.deepEqual(after.preview.speaker_palette,before.preview.speaker_palette);
  };
  const action=async(name,args={})=>{
    await page.evaluate(({name,args})=>__perf.action(name,args),{name,args});
    await page.waitForFunction(()=>__perf.actionDone,null,{timeout:120000});
    const result=await page.evaluate(()=>({error:__perf.actionError,value:__perf.actionValue}));
    assert(!result.error,result.error);assert.notEqual(result.value,false,name+' failed');await ready(page);
  };
  const resizeMany=async snap=>{
    await page.evaluate(()=>{waveformEditor.closeDockModule('properties');__perf.select(100);waveformEditor.scroll.scrollTop=0;waveformEditor.renderMultiVisible(true);});
    await ready(page);
    const block=page.locator('.waveform-row[data-row-index="0"] .waveform-cue-block[data-track="main"][data-idx="0"]').first();
    const handle=block.locator('.waveform-cue-handle.right');await handle.scrollIntoViewIfNeeded();
    const box=await handle.boundingBox(),row=await block.locator('xpath=..').boundingBox();
    const selected=await page.evaluate(()=>[...selectedIdxs].map(i=>DATA.segments[i]).concat([...selectedExtensionIdxs].map(i=>getActiveExtensionTrack().segments[i])).map(c=>({id:c.id,start:c.start,end:c.end})));
    const history=await page.evaluate(()=>editorHistory.undoLength());
    try{
      if(snap)await page.keyboard.down('Shift');
      await page.mouse.move(box.x+box.width-1,box.y+box.height/2);await page.mouse.down();
      await page.mouse.move(box.x+box.width-1-row.width/80,box.y+box.height/2,{steps:12});
    }finally{await page.mouse.up();if(snap)await page.keyboard.up('Shift');}
    await ready(page);assert.equal(await page.evaluate(()=>editorHistory.undoLength()),history+1);
    const changed=await page.evaluate(ids=>DATA.segments.concat(getActiveExtensionTrack().segments).filter(c=>ids.includes(c.id)).map(c=>({id:c.id,start:c.start,end:c.end})),selected.map(c=>c.id));
    const current=new Map(changed.map(c=>[c.id,c])),delta=current.get(selected[0].id).end-selected[0].end;
    assert.notEqual(delta,0);for(const cue of selected){assert.equal(current.get(cue.id).start,cue.start);assert.equal(current.get(cue.id).end-cue.end,delta);}
    await action('undo');await action('redo');await action('undo');
  };
  report.memory.push(await memory(cdp,'loaded'));persist();
  const start=performance.now();let cycle=startCycle;
  while(performance.now()-start<minutes*60000) {
    const t=performance.now();
    await page.evaluate(n=>{seekFromWaveform(n);return player.play();},(cycle*47)%(DURATION_MS/1000-20));
    await page.waitForTimeout(playbackSeconds*1000); // Formal acceptance uses 15 seconds of real playback per cycle.
    const playing=await page.evaluate(()=>({time:player.currentTime,paused:player.paused,ready:player.readyState}));
    assert(!playing.paused&&playing.ready>=2,'Playback stopped unexpectedly');
    await page.evaluate(()=>{player.pause();seekFromWaveform(.1);__perf.select(1);});await ready(page);
    await action('text',{text:`Acceptance ${cycle} 中文`});await action('undo');
    const operation=['split','merge','cut','paste'][cycle%4];
    if(operation==='paste')await page.evaluate(destination=>{__perf.select(100);copySelectedCues();fixedActiveTrackId=destination;waveformEditor.pointerLineRow=null;player.currentTime=0;},manifest.destination);
    else await page.evaluate(()=>__perf.select(1));
    await action(operation);await action('undo');await action('redo');await action('undo');
    if(cycle%5===0)await resizeMany(cycle%10===5);
    if(cycle%3===0){await page.evaluate(()=>{selectOnly(0,false);MSWSubtitleStyle.open('speaker');});await action('style');await action('undo');}
    await checkModel();
    await page.evaluate(()=>seekFromWaveform(.1));await ready(page);
    const fonts=await page.evaluate(async()=>(await MSWSubtitleRenderer.renderer.renderer.getStyles()).map(s=>[s.Name,s.FontSize]).sort());
    assert.deepEqual(fonts,baselineFonts,'Font sizes changed after undo and returning to the same time');
    const diagnostics=await page.evaluate(()=>MSWSubtitleRenderer.diagnostics.filter(d=>d.event==='document'));
    assert(diagnostics.every(d=>d.frame[0]===640&&d.frame[1]===360),'Preview resolution changed');
    if(cycle%10===0){await action('save');report.memory.push(await memory(cdp,`cycle-${cycle}`));}
    assert.deepEqual(report.errors,[]);report.cycles.push({cycle,operation,resizedPairs:cycle%5===0?100:0,snapping:cycle%10===5,elapsedMs:performance.now()-t,playedTo:playing.time});
    cycle++;persist();console.log(`cycle ${cycle}, ${Math.round((performance.now()-start)/60000)} min`);
  }
  await action('save');await page.reload({waitUntil:'domcontentloaded',timeout:120000});await ready(page);await page.evaluate(installProbe);await checkModel();
  report.memory.push(await memory(cdp,'reopened'));assert.equal(digest(),report.sourceHash,'Product sources changed during soak');
  report.elapsedMs=performance.now()-start;report.status='complete';report.finished=new Date().toISOString();
}catch(e){report.status='failed';report.failure=e.stack;try{report.failureState=await page?.evaluate(()=>({hint:__perf?.lastHint,saving:projectSaveInFlight,checkpoint:projectCheckpointInFlight,enabled:serverProjectSavingEnabled(),notifications:[...document.querySelectorAll('.toast,.msw-toast,.flash-hint,#project-save-error-message')].map(e=>e.textContent)}));}catch{}process.exitCode=1;console.error(e.stack);}
finally{persist();await browser?.close();await server?.stop();}
