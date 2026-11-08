import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createFixture,waveform} from '../../scripts/performance/fixtures.mjs';
import {disableOnboarding,findFreePort,makeTempDir,startServer} from './helpers.mjs';

let server,folder,file;
test.setTimeout(120000);
test.beforeAll(async()=>{
  folder=makeTempDir('save-background');
  process.env.MSW_ENV_FILE=process.env.MAW_ENV_FILE=join(folder,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(folder,'settings');
  const media=join(folder,'synthetic.mp4');file=join(folder,'project.mosp');
  execFileSync(process.env.MSW_E2E_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=640x360:r=2:d=120','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  const p=createFixture('bound',10000).project;p.media='synthetic.mp4';p.waveform=waveform();
  const stat=statSync(media);p.waveform.source={name:'synthetic.mp4',size:stat.size,modified_ms:Math.floor(stat.mtimeMs)};
  writeFileSync(file,JSON.stringify(p));server=await startServer(file,media,await findFreePort());
});
test.afterAll(async()=>{await server?.stop();});
async function ready(page){await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending,null,{timeout:90000});}
test.beforeEach(async({page})=>{
  await disableOnboarding(page);
  await page.route('**/*',route=>{const url=new URL(route.request().url());return ['http:','https:'].includes(url.protocol)&&!['localhost','127.0.0.1'].includes(url.hostname)?route.abort():route.continue();});
  await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:90000});await ready(page);
  await page.evaluate(()=>{EDITOR_SETTINGS.autoSaveProject=false;scheduleAutoSave();});
});

test('10k repeated save sends only acknowledgment; playhead skips normalization and reopens correctly',async({page})=>{
  const requests=[];page.on('request',r=>{if(r.url().endsWith('/api/msw/project'))requests.push(r.postDataJSON());});
  expect(await page.evaluate(()=>saveCurrentProject())).toBe(true);
  const compact=await page.evaluate(()=>buildSavedProjectJson());
  expect(compact).toBe(JSON.stringify(JSON.parse(compact)));
  const mtime=statSync(file).mtimeMs,source=JSON.parse(readFileSync(file));
  await page.evaluate(()=>{window.builds=0;const build=buildJson;buildJson=(...args)=>{builds++;return build(...args);};});
  expect(await page.evaluate(()=>saveCurrentProject())).toBe(true);
  expect(requests.at(-1).unchanged).toBe(true);expect(JSON.stringify(requests.at(-1)).length).toBeLessThan(500);
  expect(statSync(file).mtimeMs).toBe(mtime);
  await page.evaluate(()=>seekFromWaveform(4.125,{pauseAfterSeek:true}));
  expect(await page.evaluate(()=>saveCurrentProject())).toBe(true);
  expect(await page.evaluate(()=>builds)).toBe(0);
  const saved=JSON.parse(readFileSync(file));expect(saved.editor_state.playhead_ms).toBe(4125);expect(saved.subtitles).toEqual(source.subtitles);
  await page.reload();await ready(page);expect(await page.evaluate(()=>player.currentTime)).toBeCloseTo(4.125,2);
});

test('in-flight edits remain dirty; unchanged save still rejects a changed disk',async({page})=>{
  expect(await page.evaluate(()=>saveCurrentProject())).toBe(true);
  await page.route('**/api/msw/project',async route=>{
    const response=await route.fetch();
    await page.evaluate(()=>{DATA.segments[0].text='Edited while saving';DATA.segments[0]._dirty=true;projectImportDirty=true;});
    await route.fulfill({response});
  });
  expect(await page.evaluate(()=>saveCurrentProject())).toBe(true);
  expect(await page.evaluate(()=>hasUnsavedProjectChanges())).toBe(true);
  expect(JSON.parse(readFileSync(file)).subtitles.cues[0].content.text).not.toBe('Edited while saving');
  await page.unroute('**/api/msw/project');
  expect(await page.evaluate(()=>saveCurrentProject())).toBe(true);
  const bytes=readFileSync(file);writeFileSync(file,Buffer.concat([bytes,Buffer.from(' ')]));
  expect(await page.evaluate(()=>saveCurrentProject())).toBe(false);
  expect(readFileSync(file)).toEqual(Buffer.concat([bytes,Buffer.from(' ')]));
});

test('a host without fingerprints uses exact compact comparison and never acknowledges unseen edits',async({page})=>{
  // The runtime registry is intentionally frozen. Inject the older host
  // contract into this page only, rather than attempting to mutate it.
  await page.route(server.url,async route=>{
    const response=await route.fetch();const body=await response.text();
    const source='draftFingerprint: options=>projectDraftFingerprint(options),';
    expect(body.split(source)).toHaveLength(2);
    await route.fulfill({response,body:body.replace(source,'draftFingerprint: () => undefined,')});
  });
  await page.goto(server.url);await ready(page);
  await page.evaluate(()=>{EDITOR_SETTINGS.autoSaveProject=false;scheduleAutoSave();});
  expect(await page.evaluate(()=>MSWE.resolve('persistence-host').draftFingerprint())).toBeUndefined();
  const requests=[];page.on('request',r=>{if(r.url().endsWith('/api/msw/project'))requests.push(r.postDataJSON());});
  expect(await page.evaluate(()=>saveCurrentProject())).toBe(true);
  expect(await page.evaluate(()=>hasUnsavedProjectChanges())).toBe(false);
  await page.evaluate(()=>{DATA.language='fr';projectImportDirty=true;});
  expect(await page.evaluate(()=>saveCurrentProject())).toBe(true);
  expect(requests.every(r=>!r.unchanged)).toBe(true);
  expect(JSON.parse(readFileSync(file)).language).toBe('fr');
  expect(await page.evaluate(()=>hasUnsavedProjectChanges())).toBe(false);
});

test('idle background skips content scans; concurrent forced drafts preserve the latest edit',async({page})=>{
  expect(await page.evaluate(()=>MSWE.resolve('project-persistence').captureDraft({force:true}))).toBe(true);
  await page.evaluate(()=>{window.fingerprints=0;const fingerprint=projectDraftFingerprint;projectDraftFingerprint=(...args)=>{fingerprints++;return fingerprint(...args);};});
  await page.waitForTimeout(10500);
  expect(await page.evaluate(()=>fingerprints)).toBe(0);
  let drafts=0;
  await page.route('**/recovery-draft',async route=>{
    drafts++;if(drafts===1)await new Promise(r=>setTimeout(r,700));await route.continue();
  });
  const outcome=await page.evaluate(async()=>{
    const persistence=MSWE.resolve('project-persistence');
    const first=persistence.captureDraft({force:true});
    await new Promise(r=>setTimeout(r,100));
    DATA.segments[1].text='Latest recovery content';DATA.segments[1]._dirty=true;fixedPreviewInvalidate();
    return Promise.all([first,persistence.captureDraft({force:true})]);
  });
  expect(outcome).toEqual([true,true]);expect(drafts).toBe(2);
  const latest=await page.evaluate(async()=>{
    const host=MSWE.resolve('processing-host'),base=host.config.processingUrl,headers={'Content-Type':'application/json','X-MSW-Token':host.config.requestToken};
    const list=await (await fetch(base+'/recovery-list',{headers})).json();
    const record=list.records.find(r=>r.kind==='draft');
    return (await (await fetch(base+'/recovery-load',{method:'POST',headers,body:JSON.stringify({id:record.id})})).json()).project;
  });
  expect(latest.subtitles.cues.some(c=>c.content.text==='Latest recovery content')).toBe(true);
});

test('idle capture does not interrupt typing and changed metadata is preserved by repeated saves',async({page})=>{
  const result=await page.evaluate(async()=>{
    document.body.dispatchEvent(new Event('input',{bubbles:true}));
    const persistence=MSWE.resolve('project-persistence');
    return {busy:persistence.backgroundBusy(),draft:await persistence.captureDraft({background:true}),auto:await saveCurrentProject({silent:true,background:true})};
  });
  expect(result).toEqual({busy:true,draft:false,auto:false});
  expect(await page.evaluate(()=>saveCurrentProject())).toBe(true);
  await page.evaluate(()=>{DATA.language='ja';DATA.editor_state={...DATA.editor_state,other:'preserve'};});
  expect(await page.evaluate(()=>saveCurrentProject())).toBe(true);
  const saved=JSON.parse(readFileSync(file));expect(saved.language).toBe('ja');expect(saved.editor_state.other).toBe('preserve');
});
