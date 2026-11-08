import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createFixture,waveform} from '../../scripts/performance/fixtures.mjs';
import {disableOnboarding,findFreePort,makeTempDir,startServer} from './helpers.mjs';

// This persistence test intentionally runs without waveform generation. A
// reopened project does not retain an inline cache, so wait for media/ASS only.
async function ready(page){await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&player.readyState>=2&&MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending&&!projectSaveInFlight&&!projectCheckpointInFlight,null,{timeout:120000});}

test('10k project in two services rejects stale saves and preserves each accepted edit',async({browser})=>{
 test.setTimeout(300000);
 const folder=makeTempDir('long-multiwindow'),file=join(folder,'project.mosp'),media=join(folder,'synthetic.mp4');
 execFileSync(process.env.MSW_E2E_FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','color=black:s=640x360:r=2:d=10','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
 const p=createFixture('bound',10000).project;p.media='synthetic.mp4';p.waveform=waveform(10000);
 const st=statSync(media);p.waveform.source={name:'synthetic.mp4',size:st.size,modified_ms:Math.floor(st.mtimeMs)};
 writeFileSync(file,JSON.stringify(p));
 const services=[],contexts=[],errors=[];
 const environment=Object.fromEntries(['MSW_ENV_FILE','MAW_ENV_FILE','MSW_APP_DATA_ROOT'].map(key=>[key,process.env[key]]));
 process.env.MSW_ENV_FILE=process.env.MAW_ENV_FILE=join(folder,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(folder,'settings');
 try{
  for(let i=0;i<2;i++)services.push(await startServer(file,media,await findFreePort()));
  const pages=[];
  for(let i=0;i<2;i++){
   const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);
   await context.route('**/*',r=>{const u=new URL(r.request().url());return /^https?:$/.test(u.protocol)&&!['127.0.0.1','localhost'].includes(u.hostname)?r.abort():r.continue();});
   const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));
   await disableOnboarding(page);await page.goto(services[i].url,{timeout:120000,waitUntil:'domcontentloaded'});await ready(page);
   await page.evaluate(()=>{updateEditorSettings({selectBoundSubtitlePair:false,clickBehavior:'select-only'});autoSaveProjectToggle.checked=false;autoSaveProjectToggle.dispatchEvent(new Event('change',{bubbles:true}));});
  }
  const [a,b]=pages;
  const edit=async(page,index,text)=>page.evaluate(({index,text})=>{selectOnly(index,false);cuePanelText.value=text;cuePanelText.dispatchEvent(new Event('input',{bubbles:true}));commitCuePanelEdit();},{index,text});
  const reopen=async page=>{
   // Reloading a tab reuses its service's active snapshot. Explicitly reopen
   // the registered project to adopt changes saved by another service.
   expect(await page.evaluate(async path=>{
    const response=await fetch(SERVER_CONFIG.recentProjectsUrl,{method:'POST',headers:{'Content-Type':'application/json','X-MSW-Token':SERVER_CONFIG.requestToken},body:JSON.stringify({path})});
    return response.ok;
   },file)).toBe(true);
   await page.reload({timeout:120000,waitUntil:'domcontentloaded'});await ready(page);
  };
  const disk=()=>JSON.parse(readFileSync(file,'utf8'));
  const original=await a.evaluate(()=>MSWProductionProject.toProject(DATA).subtitles),sourceById=new Map(original.cues.map(c=>[c.id,c]));
  const aId=await a.evaluate(()=>DATA.segments[0].id),bId=await b.evaluate(()=>DATA.segments[1].id);
  await edit(a,0,'Window A accepted');expect(await a.evaluate(()=>saveProjectToServer({silent:true}))).toBe(true);
  const acceptedA=readFileSync(file);
  await edit(b,1,'Window B stale');expect(await b.evaluate(()=>saveProjectToServer({silent:true}))).toBe(false);
  expect(readFileSync(file)).toEqual(acceptedA);
  expect(await b.evaluate(()=>hasUnsavedProjectChanges())).toBe(true);
  expect(await b.locator('#cue-panel-text').inputValue()).toBe('Window B stale');
  await reopen(b);
  expect(await b.evaluate(()=>DATA.segments[0].text)).toBe('Window A accepted');
  await edit(b,1,'Window B accepted');expect(await b.evaluate(()=>saveProjectToServer({silent:true}))).toBe(true);
  const acceptedB=readFileSync(file);
  // Even the no-change acknowledgment must not silently adopt a newer disk.
  expect(await a.evaluate(()=>saveProjectToServer({silent:true}))).toBe(false);
  expect(readFileSync(file)).toEqual(acceptedB);
  await reopen(a);
  expect(await a.evaluate(()=>DATA.segments.slice(0,2).map(c=>c.text))).toEqual(['Window A accepted','Window B accepted']);
  const saved=disk().subtitles;expect(saved.bindings).toEqual(original.bindings);expect(saved.tracks).toEqual(original.tracks);
  expect(saved.cues).toHaveLength(10000);
  for(const cue of saved.cues){
   const originalCue=sourceById.get(cue.id);
   if(![aId,bId].includes(cue.id))expect(cue).toEqual(originalCue);
   else {expect(cue.track_id).toBe(originalCue.track_id);expect(cue.content.start).toBe(originalCue.content.start);expect(cue.content.end).toBe(originalCue.content.end);}
  }
  expect(errors).toEqual([]);
 }finally{
  try{for(const context of contexts)await context.close();for(const server of services)await server.stop();}
  finally{for(const [key,value] of Object.entries(environment)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 }
});
