// Synthetic frontend A/B using the same current backend. This is a focused
// save/draft workload, not the full editing matrix or historical server timing.
import fs from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import os from 'node:os';
import {chromium} from '@playwright/test';
import {createFixture,hash,waveform,audioFixture} from './performance/fixtures.mjs';
import {installProbe,measure,ready,memory} from './performance/browser.mjs';
import {summarize} from './performance/metrics.mjs';
import {startServer,findFreePort,disableOnboarding} from '../tests/e2e/helpers.mjs';

const args=process.argv.slice(2),value=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const baseline=value('--baseline','7a16c442'),out=resolve(value('--out','output/perf-persistence'));
const modes=value('--modes','previous,current').split(',');
assert.ok(modes.length&&new Set(modes).size===modes.length&&modes.every(x=>['previous','current'].includes(x)));
assert.match(baseline,/^[a-f0-9]{7,40}$/i);
assert.ok(!fs.existsSync(out),'Use a new output directory');fs.mkdirSync(out,{recursive:true});
const files=['editor.js','msw-persistence.js'];
const sources=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync('web/'+f))]));
const replacements=files.flatMap(f=>{
  const current=fs.readFileSync('web/'+f,'utf8').trimEnd().split(/(__[A-Z0-9_]+__)/);
  const previous=execFileSync('git',['show',baseline+':web/'+f],{encoding:'utf8',maxBuffer:30e6}).trimEnd().split(/(__[A-Z0-9_]+__)/);
  assert.equal(current.length,previous.length);const pairs=[];
  current.forEach((part,i)=>{if(i%2)assert.equal(part,previous[i]);else if(part!==previous[i])pairs.push([part,previous[i]]);});return pairs;
});
const media=join(out,'synthetic.mp4');
execFileSync(process.env.MSW_E2E_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=640x360:r=2:d=7200','-c:v','libx264','-preset','ultrafast','-crf','35','-pix_fmt','yuv420p',media],{windowsHide:true});
const mediaStat=fs.statSync(media),peaks=waveform();
peaks.source={name:'synthetic.mp4',size:mediaStat.size,modified_ms:Math.floor(mediaStat.mtimeMs)};
const report={schema:'msw.persistence-performance.v1',baseline,backend:'current for both sides',modes,sources,node:process.version,samples:3,warmups:1,
  environment:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,memoryBytes:os.totalmem(),viewport:{width:1440,height:1000},video:{width:640,height:360,fps:2,durationSeconds:7200}},
  backendSources:Object.fromEntries(['server-editor/serve.py','maw/msw/api.py','maw/msw/versions.py'].map(f=>[f,hash(fs.readFileSync(f))])),scenarios:[]};
const save=()=>fs.writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
let browser,server;
try {
  browser=await chromium.launch({headless:true});report.browser=browser.version();
  for(const profile of ['bound','mixed','migrated'])for(const mode of modes) {
    const dir=join(out,profile+'-'+mode);fs.mkdirSync(dir);
    process.env.MSW_APP_DATA_ROOT=join(dir,'settings');process.env.MSW_ENV_FILE=process.env.MAW_ENV_FILE=join(dir,'isolated.env');
    const p=createFixture(profile,10000).project;p.media='../synthetic.mp4';p.waveform=peaks;
    const original=join(dir,'original.mosp'),file=join(dir,'working.mosp');fs.writeFileSync(original,JSON.stringify(p));fs.copyFileSync(original,file);
    for(const a of p.msw?.assets||[]){const dest=join(dir,a.path);fs.mkdirSync(dirname(dest),{recursive:true});fs.writeFileSync(dest,audioFixture());}
    const originalHash=hash(fs.readFileSync(original)),started=performance.now();
    server=await startServer(file,media,await findFreePort());
    const row={profile,mode,errors:[],responses:[],operations:{},serverReadyMs:performance.now()-started};report.scenarios.push(row);save();
    const context=await browser.newContext({viewport:report.environment.viewport,locale:'zh-CN'}),page=await context.newPage();
    page.on('pageerror',e=>row.errors.push(e.message));page.on('dialog',d=>d.dismiss());
    page.on('response',async r=>{if(r.url().endsWith('/api/msw/project')||r.url().endsWith('/recovery-draft'))row.responses.push({route:new URL(r.url()).pathname,status:r.status(),bytes:Buffer.byteLength(r.request().postData()||'')});});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(['http:','https:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
      if(mode==='previous'&&route.request().isNavigationRequest()) {
        const response=await route.fetch();let body=await response.text();
        for(const [current,previous] of replacements){assert.equal(body.split(current).length,2,'Source block missing');body=body.replace(current,()=>previous);}
        return route.fulfill({response,body});
      }
      return route.continue();
    });
    await disableOnboarding(page);const navigation=performance.now();
    await page.goto(server.url,{timeout:180000,waitUntil:'domcontentloaded'});await ready(page);row.previewReadyMs=performance.now()-navigation;
    await page.evaluate(()=>{player.pause();autoSaveProjectToggle.checked=false;autoSaveProjectToggle.dispatchEvent(new Event('change',{bubbles:true}));});await ready(page);
    await page.evaluate(installProbe);const cdp=await context.newCDPSession(page);row.memoryLoaded=await memory(cdp,'loaded');
    for(const action of ['changed','playhead','unchanged','draft']) {
      const samples=[];row.operations[action]={samples};
      for(let i=0;i<4;i++) {
        await page.evaluate(({action,i})=>{
          if(action==='changed'){DATA.segments[0].text='Save benchmark '+i;DATA.segments[0]._dirty=true;projectImportDirty=true;fixedAcceptEdit();}
          if(action==='playhead')seekFromWaveform(10+i,{pauseAfterSeek:true});
        },{action,i});await ready(page);
        const sample=await measure(page,action==='draft'?'draft':'save',{}, {timeout:180000});
        if(i)samples.push(sample);save();console.log(profile,mode,action,i,sample.status,Math.round(sample.settledMs));
        if(sample.status!=='ok'){row.failure=sample;save();throw Error(sample.error);}
      }
      row.operations[action].summary=summarize(samples);save();
    }
    // A forced draft establishes a baseline. Observe two periodic draft ticks.
    const idle=await measure(page,'idle',{}, {idleMs:10500});row.idle=idle;
    row.memoryAfter=await memory(cdp,'after');
    const saved=JSON.parse(fs.readFileSync(file));
    assert.equal(saved.subtitles.cues.length,10000);
    const reopenedAt=performance.now();await page.reload({waitUntil:'domcontentloaded',timeout:180000});await ready(page);row.reopenMs=performance.now()-reopenedAt;
    const reopened=await page.evaluate(()=>JSON.parse(buildJson()));
    const clean=model=>JSON.parse(JSON.stringify(model,(k,v)=>k==='_dirty'?undefined:v));
    assert.deepEqual(clean(reopened.subtitles),clean(saved.subtitles),'Saved subtitle model must survive reload');
    assert.deepEqual(reopened.preview?.speaker_palette,saved.preview?.speaker_palette);
    assert.deepEqual(reopened.msw?.audio_clips,saved.msw?.audio_clips);
    assert.equal(reopened.editor_state.playhead_ms,saved.editor_state.playhead_ms);
    assert.equal(hash(fs.readFileSync(original)),originalHash);assert.deepEqual(row.errors,[]);
    row.originalUnchanged=true;row.reopenEqual=true;await cdp.detach();await context.close();await server.stop();server=null;save();
  }
  assert.deepEqual(Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync('web/'+f))])),sources,'Sources changed during measurement');
  report.complete=true;save();
} finally {await browser?.close();await server?.stop();save();}
