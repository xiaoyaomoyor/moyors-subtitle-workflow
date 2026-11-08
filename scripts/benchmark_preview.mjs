// Focused browser A/B for ASS preview. Synthetic inputs only; the same current
// localhost backend is used on both sides. This measures frontend changes, not
// a historical end-to-end backend comparison. Raw reports stay under output/.
import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import os from 'node:os';
import {chromium} from '@playwright/test';
import {createFixture,hash,waveform} from './performance/fixtures.mjs';
import {installProbe,measure,ready} from './performance/browser.mjs';
import {summarize} from './performance/metrics.mjs';
import {startServer,findFreePort,disableOnboarding} from '../tests/e2e/helpers.mjs';

const args=process.argv.slice(2),value=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const baseline=value('--baseline','d40d9ff8'),out=resolve(value('--out','output/perf-ass-preview'));
assert.match(baseline,/^[a-f0-9]{7,40}$/i);
assert.ok(!fs.existsSync(out)||fs.readdirSync(out).length===0,'Choose an empty output folder to retain earlier evidence');
fs.mkdirSync(out,{recursive:true});
process.env.MSW_APP_DATA_ROOT=join(out,'settings');process.env.MAW_ENV_FILE=join(out,'isolated.env');
const files=['editor.js','msw-production-project.js','msw-subtitle-renderer.js','msw-track-preview.js'];
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
const report={baseline,backend:'current for both sides',sources,node:process.version,samples:3,warmups:1,
  environment:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,memoryBytes:os.totalmem(),viewport:{width:1440,height:1000},video:{width:640,height:360,fps:2,durationSeconds:7200}},
  backendSources:Object.fromEntries(['subtitle_preview.py','subtitle_fonts.py','track_presentation.py'].map(f=>[f,hash(fs.readFileSync('maw/msw/'+f))])),
  scenarios:[]};
const save=()=>fs.writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
let browser,server;
try {
  browser=await chromium.launch({headless:true});report.browser=browser.version();
  for(const profile of ['bound','long-note']) {
    const project=createFixture(profile,10000).project;project.media='synthetic.mp4';project.waveform=peaks;
    const file=join(out,profile+'.mosp');fs.writeFileSync(file,JSON.stringify(project));const original=hash(fs.readFileSync(file));
    server=await startServer(file,media,await findFreePort());
    for(const mode of ['previous','current']) {
      const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'}),page=await context.newPage();
      const row={profile,mode,errors:[],operations:{}};report.scenarios.push(row);
      const settled=async()=>{
        try {await ready(page);}catch(error){row.failure={error:error.message,diagnostics:await page.evaluate(()=>({ready:MSWSubtitleStyle?.ready,media:player.readyState,peaks:waveformEditor?.peaks?.length,status:MSWSubtitleRenderer?.status,pending:MSWSubtitleRenderer?.pending,events:MSWSubtitleRenderer?.diagnostics}))};save();throw error;}
      };
      page.on('pageerror',e=>row.errors.push(e.message));page.on('dialog',d=>d.dismiss());
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(['http:','https:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
        if(mode==='previous'&&route.request().isNavigationRequest()) {
          const response=await route.fetch();let body=await response.text();
          for(const [now,old] of replacements){assert.equal(body.split(now).length,2,'Historical source must match exactly');body=body.replace(now,()=>old);}
          return route.fulfill({response,body});
        }
        return route.continue();
      });
      await disableOnboarding(page);
      await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,subtitleAvoidControls:false})));
      console.log(profile,mode,'starting');save();
      await page.goto(server.url,{timeout:180000,waitUntil:'domcontentloaded'});await settled();console.log(profile,mode,'ready');
      await page.evaluate(()=>{
        player.pause();updateEditorSettings({selectBoundSubtitlePair:false});
        autoSaveProjectToggle.checked=false;autoSaveProjectToggle.dispatchEvent(new Event('change',{bubbles:true}));
        window.previewProbe={reads:0,ms:0};const read=MSWProductionProject.toProject;
        MSWProductionProject.toProject=(...args)=>{const start=performance.now();try{return read(...args);}finally{if(args[1]?.previewWindow){previewProbe.reads++;previewProbe.ms+=performance.now()-start;}}};
      });
      await page.evaluate(installProbe);
      await page.evaluate(()=>{previewProbe.reads=0;previewProbe.ms=0;});
      await page.waitForTimeout(2400);row.idle=await page.evaluate(()=>({...previewProbe}));
      for(const action of ['text','style']) {
        const samples=[];row.operations[action]={samples};
        for(let i=0;i<4;i++) {
          await page.evaluate(action=>{
            selectOnly(0,false);seekFromWaveform(.1);
            if(action==='style')MSWSubtitleStyle.open('track');
          },action);await settled();
          await page.evaluate(()=>{previewProbe.reads=0;previewProbe.ms=0;});
          const sample=await measure(page,action,{text:'Preview benchmark '+i},{preview:true,timeout:180000});
          sample.projection=await page.evaluate(()=>({...previewProbe}));
          if(sample.status!=='ok'){row.failure=sample;save();throw Error(sample.error);}
          if(i)samples.push(sample);
          save();console.log(profile,mode,action,i,sample.status,Math.round(sample.settledMs));
          await page.evaluate(()=>performUndo());await settled();
        }
        row.operations[action].summary=summarize(samples);save();
        console.log(profile,mode,action,JSON.stringify(row.operations[action].summary));
      }
      row.geometry=await page.evaluate(()=>({count:MSWSubtitleRenderer.geometry.length,frames:MSWSubtitleRenderer.diagnostics.filter(d=>d.event==='document').map(d=>d.frame)}));
      row.geometryKeyMs=await page.evaluate(()=>Array.from({length:5},()=>{const start=performance.now();fixedGeometryKey();return performance.now()-start;}));
      assert.deepEqual(row.errors,[]);assert.equal(hash(fs.readFileSync(file)),original,'Benchmark must not save the source fixture');
      row.originalUnchanged=true;await context.close();save();
    }
    await server.stop();server=null;
  }
  assert.deepEqual(Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync('web/'+f))])),sources,'Sources changed during measurement');
  report.complete=true;save();
} finally {await browser?.close();await server?.stop();save();}
