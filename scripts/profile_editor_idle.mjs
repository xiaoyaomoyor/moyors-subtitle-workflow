#!/usr/bin/env node
// Optional idle attribution, separate from the timed performance matrix.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,existsSync,statSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createFixture,waveform,audioFixture} from './performance/fixtures.mjs';
import {installProbe,ready} from './performance/browser.mjs';

const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const media=resolve(option('--media','')),root=resolve(option('--out','output/idle-profile'));
assert(args.includes('--media'),'Pass a synthetic two-hour media fixture');
assert(!existsSync(root),'Use a new output directory');mkdirSync(root,{recursive:true});
if(!process.env.MSW_E2E_PYTHON&&existsSync('.venv/Scripts/python.exe'))process.env.MSW_E2E_PYTHON=resolve('.venv/Scripts/python.exe');
process.env.MSW_ENV_FILE=join(root,'isolated.env');process.env.MAW_ENV_FILE=process.env.MSW_ENV_FILE;
process.env.MSW_APP_DATA_ROOT=join(root,'settings');
const {startServer,findFreePort,disableOnboarding}=await import('../tests/e2e/helpers.mjs');
const {project}=createFixture('mixed',10000);project.media=media;project.waveform=waveform();
const st=statSync(media);project.waveform.source={name:media.split(/[\\/]/).at(-1),size:st.size,modified_ms:Math.floor(st.mtimeMs)};
const path=join(root,'project.mosp');writeFileSync(path,JSON.stringify(project));
for(const asset of project.msw.assets){const p=join(root,asset.path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,audioFixture());}
const report={schema:'msw.idle-profile.v1',status:'running',errors:[]};
let server,browser;
try{
 server=await startServer(path,media,await findFreePort());browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 await context.route('**/*',r=>{const u=new URL(r.request().url());return /^https?:$/.test(u.protocol)&&!['127.0.0.1','localhost'].includes(u.hostname)?r.abort():r.continue();});
 page.on('pageerror',e=>report.errors.push(e.message));await disableOnboarding(page);
 await page.goto(server.url,{timeout:120000,waitUntil:'domcontentloaded'});await ready(page);
 await page.evaluate(()=>{autoSaveProjectToggle.checked=false;autoSaveProjectToggle.dispatchEvent(new Event('change',{bubbles:true}));player.pause();seekFromWaveform(.1);});await ready(page);
 assert(await page.evaluate(()=>saveProjectToServer({silent:true})));await ready(page);
 await page.evaluate(installProbe);
 await page.evaluate(()=>{
  window.idleFingerprintCalls=0;const original=projectDraftFingerprint;
  projectDraftFingerprint=function(...args){idleFingerprintCalls++;return original.apply(this,args);};
 });
 const cdp=await context.newCDPSession(page);await cdp.send('Profiler.enable');
 const events=[];
 cdp.on('Tracing.dataCollected',data=>events.push(...data.value));
 await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,disabled-by-default-v8.gc',transferMode:'ReportEvents'});
 await cdp.send('Profiler.start');await page.evaluate(()=>__perf.begin());
 await page.waitForTimeout(31000);
 const {profile}=await cdp.send('Profiler.stop');
 report.sample=await page.evaluate(()=>({...__perf.end(),fingerprintCalls:idleFingerprintCalls,tasks:__perf.longTasks}));
 const traced=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
 await cdp.send('Tracing.end');await traced;
 writeFileSync(join(root,'idle.trace.json'),JSON.stringify({traceEvents:events}));
 const durations=new Map();
 for(const event of events)if(event.ph==='X'&&event.dur){
  const key=event.name,entry=durations.get(key)||{count:0,ms:0,maxMs:0};
  entry.count++;entry.ms+=event.dur/1000;entry.maxMs=Math.max(entry.maxMs,event.dur/1000);durations.set(key,entry);
 }
 // Nested and multi-thread trace events overlap; do not add these into CPU total.
 report.traceEvents=[...durations].map(([name,value])=>({name,...value})).sort((a,b)=>b.ms-a.ms).slice(0,40);
 writeFileSync(join(root,'idle.cpuprofile'),JSON.stringify(profile));
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),times=new Map();
 for(let i=0;i<profile.samples.length;i++)times.set(profile.samples[i],(times.get(profile.samples[i])||0)+profile.timeDeltas[i]/1000);
 report.selfTime=[...times].sort((a,b)=>b[1]-a[1]).slice(0,40).map(([id,ms])=>{
  const f=nodes.get(id).callFrame;return {name:f.functionName||'(anonymous)',line:f.lineNumber+1,ms};
 });
 assert.deepEqual(report.errors,[]);assert.equal(report.sample.fingerprintCalls,0);
 assert.equal(report.sample.previewRequests.length,0);report.status='complete';
}catch(e){report.status='failed';report.failure=e.message;process.exitCode=1;console.error(e.stack);}
finally{writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await server?.stop();}
