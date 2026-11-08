#!/usr/bin/env node
// Opt-in, synthetic, local-only. Each run owns a new directory and server.
import {chromium} from '@playwright/test';
import {existsSync,mkdirSync,writeFileSync,readFileSync,statSync,copyFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createFixture,parseScenario,MATRIX,waveform,audioFixture,hash,DURATION_MS} from './performance/fixtures.mjs';
import {REPORT_SCHEMA,HARNESS_VERSION,summarize,compareReports} from './performance/metrics.mjs';
import {installProbe,measure,ready,memory} from './performance/browser.mjs';
import {runModelProbes} from './performance/probes.mjs';

const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
if(args.includes('--help')) {
  console.log('node scripts/benchmark_editor.mjs [--matrix bound:1000,bound:6000,bound:10000,bound:15000,mixed:10000,migrated:10000] [--repeats 3] [--warmup 1] [--idle-ms 6000] [--out NEW_DIRECTORY]\nnode scripts/benchmark_editor.mjs --compare BEFORE.json AFTER.json\nRequires FFmpeg (MSW_E2E_FFMPEG or PATH), project Python and Playwright Chromium. No cloud requests.');
  process.exit(0);
}
if(args.includes('--compare')) {
  const i=args.indexOf('--compare'),files=args.slice(i+1,i+3);
  if(files.length!==2)throw Error('--compare requires two report paths');
  const result=compareReports(...files.map(f=>JSON.parse(readFileSync(f,'utf8'))));console.log(JSON.stringify(result,null,2));
  process.exit(!result.compatible||result.failures?.length||result.missing?.length?1:result.rows.some(r=>r.regression)?2:0);
}
const repeats=Number(option('--repeats','3')),warmup=Number(option('--warmup','1')),idleMs=Number(option('--idle-ms','6000'));
if(!Number.isInteger(repeats)||repeats<1||repeats>100||!Number.isInteger(warmup)||warmup<0||warmup>10||!Number.isInteger(idleMs)||idleMs<1000||idleMs>60000)throw Error('Invalid repeat, warmup or idle setting');
const scenarios=option('--matrix',MATRIX.join(',')).split(',').map(parseScenario);
if(scenarios.some(s=>s.count<1000))throw Error('Browser workload needs at least 1000 cues; smaller fixtures are model-only');
const names=scenarios.map(s=>`${s.profile}-${s.count}`);if(new Set(names).size!==names.length)throw Error('Duplicate scenarios');
const root=resolve(option('--out',`output/editor-performance/${new Date().toISOString().replace(/[:.]/g,'-')}`));
if(existsSync(root))throw Error('Output directory already exists; use a new directory to preserve previous results');
mkdirSync(root,{recursive:true});mkdirSync(join(root,'media'));
const ffmpeg=process.env.MSW_E2E_FFMPEG||process.env.MSW_TEST_FFMPEG||'ffmpeg';
if(!process.env.MSW_E2E_PYTHON&&existsSync('.venv/Scripts/python.exe'))process.env.MSW_E2E_PYTHON=resolve('.venv/Scripts/python.exe');
const {startServer,findFreePort,disableOnboarding}=await import('../tests/e2e/helpers.mjs');
const command=(file,argv)=>execFileSync(file,argv,{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024}).trim();
const version=(file,argv)=>command(file,argv).split(/\r?\n/)[0];
const video={width:640,height:360,fps:2,durationMs:DURATION_MS},viewport={width:1440,height:1000};
const environment={commit:command('git',['rev-parse','HEAD']),node:process.version,
  python:process.env.MSW_E2E_PYTHON?version(process.env.MSW_E2E_PYTHON,['--version']):version('uv',['run','--frozen','python','--version']),
  ffmpeg:version(ffmpeg,['-version']),platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model||'',cpuThreads:os.cpus().length,memoryBytes:os.totalmem(),headless:true};
environment.harnessHash=hash(['scripts/benchmark_editor.mjs',...['fixtures','metrics','browser','probes'].map(n=>`scripts/performance/${n}.mjs`)].map(p=>readFileSync(p,'utf8').replaceAll('\r\n','\n')));
const fontScript='import hashlib,json; from maw.msw.subtitle_fonts import installed_fonts; print(hashlib.sha256(json.dumps(sorted((n,sorted(p.stat().st_size for p in paths)) for n,paths in installed_fonts().items())).encode()).hexdigest())';
environment.fontInventoryHash=process.env.MSW_E2E_PYTHON?command(process.env.MSW_E2E_PYTHON,['-c',fontScript]):command('uv',['run','--frozen','python','-c',fontScript]);
const media=join(root,'media','synthetic.mp4');
command(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i',`color=c=gray:s=${video.width}x${video.height}:r=${video.fps}:d=${DURATION_MS/1000}`,'-c:v','libx264','-preset','ultrafast','-crf','35','-pix_fmt','yuv420p','-an',media]);
const mediaStat=statSync(media),peakPayload=waveform();
peakPayload.source={name:'synthetic.mp4',size:mediaStat.size,modified_ms:Math.floor(mediaStat.mtimeMs)};
const index={schema:REPORT_SCHEMA,harnessVersion:HARNESS_VERSION,createdAt:new Date().toISOString(),reports:[]};
const writeIndex=()=>writeFileSync(join(root,'index.json'),JSON.stringify(index,null,2)+'\n');
let failures=0;
for(const scenario of scenarios) {
  const name=`${scenario.profile}-${scenario.count}`,dir=join(root,name);mkdirSync(dir);
  const {project,manifest}=createFixture(scenario.profile,scenario.count);project.waveform=peakPayload;
  const original=join(dir,'fixture.mosp'),working=join(dir,'working.mosp');
  writeFileSync(original,JSON.stringify(project));copyFileSync(original,working);
  for(const asset of project.msw?.assets||[]) {const path=join(dir,asset.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,audioFixture());}
  const originalHash=hash(readFileSync(original));
  process.env.MSW_APP_DATA_ROOT=join(dir,'settings');process.env.MAW_ENV_FILE=join(dir,'isolated.env');
  const report={schema:REPORT_SCHEMA,harnessVersion:HARNESS_VERSION,createdAt:new Date().toISOString(),fixture:manifest,environment:{...environment},
    config:{repeats,warmup,idleMs,viewport,video},startup:{},operations:{},memory:[],errors:[],status:'running'};
  const output=join(dir,'report.json'),write=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  index.reports.push({scenario:name,path:`${name}/report.json`});writeIndex();write();
  let server,browser,cdp,page;
  console.log(`[${name}] starting`);
  try {
    const serverStart=performance.now();server=await startServer(working,media,await findFreePort());report.startup.serverReadyMs=performance.now()-serverStart;
    browser=await chromium.launch({headless:true,...(process.env.MSW_E2E_CHROMIUM_PATH?{executablePath:process.env.MSW_E2E_CHROMIUM_PATH}:{})});
    report.environment.browser=browser.version();
    const context=await browser.newContext({viewport,locale:'zh-CN'});page=await context.newPage();
    page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',dialog=>dialog.dismiss());
    await context.route('**/*',route=>{const url=new URL(route.request().url());return ['http:','https:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname)?route.abort():route.continue();});
    await disableOnboarding(page);
    const navigation=performance.now();await page.goto(server.url,{timeout:120000,waitUntil:'domcontentloaded'});report.startup.domContentLoadedMs=performance.now()-navigation;
    write();await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&player.readyState>=2&&waveformEditor?.peaks?.length>0,null,{timeout:120000});report.startup.editorReadyMs=performance.now()-navigation;write();
    await ready(page);report.startup.previewReadyMs=performance.now()-navigation;write();console.log(`[${name}] preview ready`);
    await page.evaluate(()=>{
      updateEditorSettings({selectBoundSubtitlePair:false,clickBehavior:'select-only'});
      // The UI handler also cancels the interval created during initialization.
      autoSaveProjectToggle.checked=false;autoSaveProjectToggle.dispatchEvent(new Event('change',{bubbles:true}));
      if(EDITOR_SETTINGS.autoSaveProject||autoSaveTimer!==null)throw Error('Automatic save was not disabled');
      player.pause();waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=10;waveformEditor.settings.rowHeight=220;waveformEditor.render();seekFromWaveform(.1);
    });
    await ready(page);await page.evaluate(installProbe);
    cdp=await context.newCDPSession(page);report.memory.push(await memory(cdp,'loaded'));
    const before=await page.evaluate(()=>__perf.snapshot());
    assert.equal(before.subtitles.cues.length,scenario.count);
    const cleanupUndo=async()=>{await page.evaluate(()=>performUndo());await ready(page);};
    const select=async count=>page.evaluate(n=>__perf.select(n),count);
    const preparePaste=async count=>{
      await select(count);await page.evaluate(destination=>{copySelectedCues();fixedActiveTrackId=destination;waveformEditor.pointerLineRow=null;player.currentTime=0;},manifest.destination);
    };
    const run=async(name,action,prepare=async()=>{},cleanup=async()=>{},options={})=>{
      const entry=report.operations[name]={samples:[],summary:summarize([])};
      for(let i=0;i<warmup+repeats;i++) {
        await prepare(i);await ready(page);
        const sample=await measure(page,action,options.args?.(i)||{},options);
        sample.iteration=i-warmup;sample.warmup=i<warmup;
        if(i<warmup)(entry.warmup||=[]).push(sample);else entry.samples.push(sample);
        entry.summary=summarize(entry.samples);write();
        if(sample.status!=='ok')throw Error(`${name}: ${sample.error}`);
        await cleanup(i);
      }
      console.log(`[${name}] sync=${Math.round(entry.summary.syncMs.median)}ms settled=${Math.round(entry.summary.settledMs.median)}ms`);
    };
    await run('select','select',async()=>page.evaluate(()=>selectOnly(0,false)));
    await run('context-menu','context-menu',async()=>{},async()=>page.evaluate(()=>ctxmenu.classList.remove('show')));
    await run('seek-preview','seek',async i=>{await page.evaluate(t=>seekFromWaveform(t),i%2?31:.1);await ready(page);},async()=>{}, {preview:true,args:i=>({time:i%2?.1:31})});
    await page.evaluate(()=>seekFromWaveform(.1));await ready(page);
    for(const count of [1,100]) {
      await run(`copy-${count}`,'copy',()=>select(count));
      await run(`paste-${count}`,'paste',()=>preparePaste(count),cleanupUndo);
      await run(`undo-paste-${count}`,'undo',async()=>{await preparePaste(count);assert.equal(await page.evaluate(()=>productionPasteClipboard()),true);});
      await run(`redo-paste-${count}`,'redo',async()=>{await preparePaste(count);assert.equal(await page.evaluate(()=>productionPasteClipboard()),true);await cleanupUndo();},cleanupUndo);
    }
    await run('cut-pair','cut',()=>select(1),cleanupUndo);
    await run('split-pair','split',async()=>{await select(1);},cleanupUndo);
    await run('merge-pairs','merge',async()=>{await page.evaluate(()=>clearSelection({silent:true}));},cleanupUndo);
    await run('text-preview','text',async()=>page.evaluate(()=>{selectOnly(0,false);seekFromWaveform(.1);}),cleanupUndo,{preview:true,args:i=>({text:`Edited benchmark text ${i}`})});
    for(const scope of ['cue','track','speaker'])await run(`${scope}-style-preview`,'style',async()=>{
      await page.evaluate(scope=>{selectOnly(0,false);fixedActiveTrackId=fixedOwner(DATA.segments[0],'main');MSWSubtitleStyle.open(scope);},scope);
    },cleanupUndo,{preview:true});
    await page.evaluate(()=>{waveformEditor.closeDockModule('properties');MSWFindEdit.open();});await page.waitForTimeout(350);
    await run('search','search',async()=>{await page.locator('#find-edit-query').fill('');await page.waitForTimeout(350);},async()=>{}, {search:true,searchCount:before.subtitles.cues.filter(c=>c.content.text.includes('reproducible')).length});
    await page.evaluate(()=>MSWFindEdit.close());
    await page.evaluate(()=>{__perf.select(1);waveformEditor.scroll.scrollTop=0;waveformEditor.renderMultiVisible(true);});
    for(const gesture of [{name:'drag-pair',count:1,resize:false},{name:'resize-pair',count:1,resize:true},{name:'resize-100-pairs',count:100,resize:true}]) {
      const drag=report.operations[gesture.name]={samples:[],summary:summarize([])};
      for(let i=0;i<warmup+repeats;i++) {
        await select(gesture.count);await ready(page);
        const rowIndex=gesture.resize?await page.evaluate(()=>Math.floor((DATA.segments[0].end-1)/10000)):0;
        await page.evaluate(rowIndex=>{waveformEditor.scroll.scrollTop=rowIndex*240;waveformEditor.renderMultiVisible(true);},rowIndex);
        const block=page.locator(`.waveform-row[data-row-index="${rowIndex}"] .waveform-cue-block[data-track="main"][data-idx="0"]`).first();
        const handle=gesture.resize?block.locator('.waveform-cue-handle.right'):block;await handle.scrollIntoViewIfNeeded();
        const box=await handle.boundingBox();
        const target=gesture.resize?box.y+box.height/2:await page.evaluate(destination=>{
          const row=document.querySelector('.waveform-row'),r=row.getBoundingClientRect(),lane=fixedLayout().positions.get(JSON.stringify([destination,'main']));
          return r.bottom-7-(parseFloat(row.style.getPropertyValue('--audio-lane-space'))||0)-lane*waveformEditor.subtitleGeometry().pitch-waveformEditor.subtitleGeometry().height/2;
        },manifest.destination);
        const selected=await page.evaluate(()=>[...selectedIdxs].map(i=>DATA.segments[i]).concat([...selectedExtensionIdxs].map(i=>getActiveExtensionTrack().segments[i])).map(c=>({id:c.id,start:c.start,end:c.end})));
        const rowBox=await block.locator('xpath=..').boundingBox();
        const history=await page.evaluate(()=>editorHistory.undoLength());
        await page.evaluate(()=>__perf.begin());const x=box.x+(gesture.resize?box.width-1:Math.min(box.width/2,45)),y=box.y+box.height/2;
        await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+(gesture.resize?-rowBox.width/100:20),target,{steps:12});await page.mouse.up();
        const feedbackMs=await page.evaluate(()=>__perf.paint());
        const sample={status:'ok',syncMs:null,feedbackMs,...await page.evaluate(()=>__perf.end())};
        try {
          assert.equal(await page.evaluate(()=>editorHistory.undoLength()),history+1,'Gesture must create exactly one history record');
          const changed=await page.evaluate(ids=>DATA.segments.concat(getActiveExtensionTrack().segments).filter(c=>ids.includes(c.id)).map(c=>({id:c.id,start:c.start,end:c.end})),selected.map(c=>c.id));
          const current=new Map(changed.map(c=>[c.id,c])),delta=current.get(selected[0].id).end-selected[0].end;
          assert.notEqual(delta,0,'Gesture must change timing');
          for(const c of selected){assert.equal(current.get(c.id).end-c.end,delta);assert.equal(current.get(c.id).start-c.start,gesture.resize?0:delta);}
          if(!gesture.resize)assert.equal(await page.evaluate(id=>fixedOwner(DATA.segments.find(c=>c.id===id),'main'),manifest.firstCue),manifest.destination);
        }catch(error){sample.status='failed';sample.error=error.message;}
        if(i<warmup)(drag.warmup||=[]).push(sample);else drag.samples.push(sample);drag.summary=summarize(drag.samples);write();
        if(sample.status!=='ok')throw Error(`${gesture.name}: ${sample.error}`);await cleanupUndo();
      }
      console.log(`[${gesture.name}] gesture=${Math.round(drag.summary.feedbackMs.median)}ms`);
    }
    await run('save-changed','save',async i=>{await page.evaluate(i=>{selectOnly(0,false);cuePanelText.value=`Saved benchmark ${i}`;cuePanelText.dispatchEvent(new Event('input',{bubbles:true}));commitCuePanelEdit();},i);},cleanupUndo,{timeout:120000});
    await run('save-playhead','save',async i=>{await page.evaluate(t=>seekFromWaveform(t),10+i);},async()=>{},{timeout:120000});
    assert.equal(await page.evaluate(()=>saveProjectToServer({silent:true})),true);
    await run('save-unchanged','save');
    await run('recovery-draft','draft',async()=>{},async()=>{},{timeout:120000});
    await run('idle','idle',async()=>{},async()=>{},{idleMs});
    report.memory.push(await memory(cdp,'after-editing'));
    const after=await page.evaluate(()=>__perf.snapshot());
    const comparable=value=>JSON.parse(JSON.stringify(value,(key,v)=>key.startsWith('_')?undefined:v));
    assert.deepEqual(comparable(after.subtitles),comparable(before.subtitles));
    assert.deepEqual(comparable(after.preview?.speaker_palette),comparable(before.preview?.speaker_palette));
    assert.equal(hash(readFileSync(original)),originalHash);
    assert.equal(await page.evaluate(()=>saveProjectToServer({silent:true})),true);
    const disk=JSON.parse(readFileSync(working,'utf8'));assert.deepEqual(comparable(disk.subtitles),comparable(after.subtitles));
    const reload=performance.now();await page.reload({waitUntil:'domcontentloaded',timeout:120000});await ready(page);report.startup.reloadPreviewReadyMs=performance.now()-reload;
    assert.deepEqual(comparable(await page.evaluate(()=>MSWProductionProject.toProject(DATA).subtitles)),comparable(after.subtitles));
    report.memory.push(await memory(cdp,'reopened'));
    report.integrity={originalUnchanged:true,undoRestoredModel:true,speakerPaletteRestored:true,savedAndReopened:true};
    if(report.errors.length)throw Error('Browser page errors: '+report.errors.join('; '));
    report.status='complete';
  }catch(error){
    failures++;report.status='failed';report.failure=String(error.message).replaceAll(root,'<run>');
    if(page&&!page.isClosed())report.diagnostics=await page.evaluate(()=>({renderer:window.MSWSubtitleRenderer?{status:MSWSubtitleRenderer.status,pending:MSWSubtitleRenderer.pending,diagnostics:MSWSubtitleRenderer.diagnostics}:null,readyState:window.player?.readyState,hint:window.__perf?.lastHint,saving:projectSaveInFlight,checkpoint:projectCheckpointInFlight})).catch(()=>null);
    console.log(`[${name}] FAILED: ${report.failure}`);
  }
  finally {write();await cdp?.detach().catch(()=>{});await browser?.close();await server?.stop();}
  console.log(`[${name}] ${report.status}`);
}
index.modelProbes=runModelProbes(10000,3);
index.status=failures?'failed':'complete';writeIndex();console.log(`Reports: ${root}`);process.exitCode=failures?1:0;
