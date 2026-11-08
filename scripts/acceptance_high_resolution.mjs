#!/usr/bin/env node
// Companion to acceptance_video_export.py; uses only that synthetic output.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {installProbe,ready,memory} from './performance/browser.mjs';

const folder=resolve(process.argv[2]||''),fixture=join(folder,'highres.mosp');
assert(process.argv[2],'Pass the synthetic export acceptance output directory');
const p=JSON.parse(readFileSync(fixture,'utf8'));
assert.equal(p.media,'highres-source.mp4');assert.equal(p.subtitles.cues.length,10000);
if(!process.env.MSW_E2E_PYTHON&&existsSync('.venv/Scripts/python.exe'))process.env.MSW_E2E_PYTHON=resolve('.venv/Scripts/python.exe');
process.env.MSW_ENV_FILE=join(folder,'highres.env');process.env.MAW_ENV_FILE=process.env.MSW_ENV_FILE;
process.env.MSW_APP_DATA_ROOT=join(folder,'highres-settings');
const {startServer,findFreePort,disableOnboarding}=await import('../tests/e2e/helpers.mjs');
const report={schema:'msw.high-resolution-acceptance.v1',status:'running',errors:[],playback:[]};
let server,browser;
try {
  server=await startServer(fixture,join(folder,p.media),await findFreePort());
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1920,height:1080}});
  await context.route('**/*',r=>{const u=new URL(r.request().url());return /^https?:$/.test(u.protocol)&&!['127.0.0.1','localhost'].includes(u.hostname)?r.abort():r.continue();});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await disableOnboarding(page);await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:120000});await ready(page);
  await page.evaluate(()=>{updateEditorSettings({clickBehavior:'select-only'});autoSaveProjectToggle.checked=false;autoSaveProjectToggle.dispatchEvent(new Event('change',{bubbles:true}));seekFromWaveform(.1);});await ready(page);await page.evaluate(installProbe);
  const before=await page.evaluate(()=>__perf.snapshot().subtitles);
  assert.deepEqual(await page.evaluate(()=>[player.videoWidth,player.videoHeight]),[1920,1080]);
  for(const second of [.1,3]) {
    await page.evaluate(t=>{seekFromWaveform(t);return player.play();},second);
    await page.waitForTimeout(2000);
    const sample=await page.evaluate(()=>{const q=player.getVideoPlaybackQuality();return {time:player.currentTime,paused:player.paused,totalFrames:q.totalVideoFrames,droppedFrames:q.droppedVideoFrames};});
    assert(!sample.paused&&sample.time>second+1);report.playback.push(sample);
    await page.evaluate(()=>player.pause());await ready(page);
  }
  await page.evaluate(()=>{seekFromWaveform(.1);__perf.select(1);__perf.action('text',{text:'High resolution 中文 edit'});});
  await page.waitForFunction(()=>__perf.actionDone);assert.equal(await page.evaluate(()=>__perf.actionError),null);await ready(page);
  const rendered=await page.evaluate(async()=>(await MSWSubtitleRenderer.renderer.renderer.getEvents()).map(e=>e.Text).join('\n'));
  assert(rendered.includes('High resolution'));
  await page.evaluate(()=>performUndo());await ready(page);
  assert.deepEqual(await page.evaluate(()=>__perf.snapshot().subtitles),before);
  report.frames=await page.evaluate(()=>MSWSubtitleRenderer.diagnostics.filter(d=>d.event==='document').map(d=>d.frame));
  assert(report.frames.length&&report.frames.every(f=>f[0]===1920&&f[1]===1080));
  await page.locator('.player-stage').screenshot({path:join(folder,'highres-preview.png')});
  report.memory=await memory(await context.newCDPSession(page),'after-edit');
  assert.deepEqual(report.errors,[]);report.status='complete';
}catch(e){report.status='failed';report.failure=e.stack;process.exitCode=1;console.error(e.stack);}
finally{writeFileSync(join(folder,'highres-browser.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await server?.stop();}
