import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createFixture,waveform} from '../../scripts/performance/fixtures.mjs';
import {disableOnboarding,findFreePort,makeTempDir,startServer} from './helpers.mjs';

let server,folder;
test.beforeAll(async()=>{
  folder=makeTempDir('ass-preview-efficiency');
  process.env.MAW_ENV_FILE=join(folder,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(folder,'settings');
  const media=join(folder,'synthetic.mp4'),project=join(folder,'project.mosp');
  execFileSync(process.env.MSW_E2E_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=640x360:r=2:d=120','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  const p=createFixture('long-note',10000).project;p.media='synthetic.mp4';p.waveform=waveform();
  p.preview.speaker_palette.rows[0].role_styles={main:{style:{fontName:'Arial'}},secondary:{style:{fontName:'Consolas'}}};
  writeFileSync(project,JSON.stringify(p));server=await startServer(project,media,await findFreePort());
});
test.afterAll(async()=>{await server?.stop();});

async function ready(page){await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending,null,{timeout:90000});}
test.beforeEach(async({page})=>{
  await disableOnboarding(page);
  await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,subtitleAvoidControls:false})));
  await page.route('**/*',route=>{const url=new URL(route.request().url());return ['http:','https:'].includes(url.protocol)&&!['localhost','127.0.0.1'].includes(url.hostname)?route.abort():route.continue();});
});

test('10,000-cue preview stays local, loads role fonts and does no idle project copies',async({page})=>{
  const requests=[],fonts=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith('/subtitle-preview'))requests.push(r.postDataJSON());if(r.method()==='POST'&&r.url().endsWith('/subtitle-fonts'))fonts.push(r.postDataJSON());});
  await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:90000});await ready(page);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(p=>p.project.subtitles.cues.length<150)).toBe(true);
  expect(fonts.flatMap(p=>p.families)).toEqual(expect.arrayContaining(['Arial','Consolas']));
  await page.evaluate(()=>{
    const read=MSWProductionProject.toProject;
    window.previewReads=0;MSWProductionProject.toProject=(...args)=>{if(args[1]?.previewWindow)previewReads++;return read(...args);};
  });
  const before=requests.length;
  await page.waitForTimeout(2400); // Observe at least three old polling intervals.
  expect(await page.evaluate(()=>previewReads)).toBe(0);
  expect(requests.length).toBe(before);
  expect(await page.evaluate(()=>MSWSubtitleRenderer.diagnostics.filter(d=>d.event==='document').every(d=>d.frame[0]===640&&d.frame[1]===360))).toBe(true);
  expect(errors).toEqual([]);
});

test('edits during an in-flight render coalesce and only the newest style becomes current',async({page})=>{
  test.setTimeout(120000);
  await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:90000});await ready(page);
  let release,blocked,requests=0;
  const gate=new Promise(resolve=>release=resolve),arrived=new Promise(resolve=>blocked=resolve);
  await page.route('**/subtitle-preview',async route=>{
    requests++;const response=await route.fetch();
    if(requests===1){blocked();await gate;}
    await route.fulfill({response});
  });
  await page.evaluate(()=>{
    const h=MSWE.resolve('processing-host'),read=MSWProductionProject.toProject;
    window.previewReads=0;MSWProductionProject.toProject=(...args)=>{if(args[1]?.previewWindow)previewReads++;return read(...args);};
    const style=MSWSubtitleStyle.currentPreview().style;style.main.fontSize=64;h.commitProjectStyle(style);
  });
  await arrived;
  for(const size of [66,68,70])await page.evaluate(size=>{
    const h=MSWE.resolve('processing-host'),s=MSWSubtitleStyle.currentPreview().style;s.main.fontSize=size;h.commitProjectStyle(s);
  },size);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(()=>previewReads)).toBe(1);
  release();await ready(page);
  expect(requests).toBe(2);
  expect(await page.evaluate(()=>previewReads)).toBe(2);
  const result=await page.evaluate(async()=>({styles:await MSWSubtitleRenderer.renderer.renderer.getStyles(),events:await MSWSubtitleRenderer.renderer.renderer.getEvents(),diagnostics:MSWSubtitleRenderer.diagnostics}));
  expect(result.styles.some(s=>s.FontSize===70)).toBe(true);
  expect(result.styles.some(s=>s.FontSize===64||s.FontSize===66||s.FontSize===68)).toBe(false);
  expect(result.events.length).toBeGreaterThan(0);
  expect(result.diagnostics.some(d=>d.event==='discard')).toBe(true);
});

test('text, undo and changing the preview window update ASS without changing font scale',async({page})=>{
  await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:90000});await ready(page);
  const events=()=>page.evaluate(async()=>(await MSWSubtitleRenderer.renderer.renderer.getEvents()).map(e=>e.Text).join('\n'));
  const before=await events();
  await page.evaluate(()=>{selectOnly(0,false);cuePanelText.value='Latest text 中文';cuePanelText.dispatchEvent(new Event('input',{bubbles:true}));commitCuePanelEdit();});await ready(page);
  expect(await events()).toContain('Latest text');
  await page.evaluate(()=>performUndo());await ready(page);expect(await events()).toBe(before);
  for(const time of [31,61,.1]){await page.evaluate(t=>seekFromWaveform(t),time);await ready(page);}
  const docs=await page.evaluate(()=>MSWSubtitleRenderer.diagnostics.filter(d=>d.event==='document'));
  expect(docs.length).toBeGreaterThanOrEqual(5);
  expect(docs.every(d=>d.cues<150&&d.frame[0]===640&&d.frame[1]===360)).toBe(true);
  expect(docs.every(d=>JSON.stringify(d.fontSizes)===JSON.stringify(docs[0].fontSizes))).toBe(true);
});

test('a validation-only revision during a request does not resend the same ASS',async({page})=>{
  await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:90000});await ready(page);
  let release,arrived,requests=0;
  const gate=new Promise(resolve=>release=resolve),blocked=new Promise(resolve=>arrived=resolve);
  await page.route('**/subtitle-preview',async route=>{
    requests++;const response=await route.fetch();
    if(requests===1){arrived();await gate;}
    await route.fulfill({response});
  });
  await page.evaluate(()=>{const s=MSWSubtitleStyle.currentPreview().style;s.main.fontSize=65;MSWE.resolve('processing-host').commitProjectStyle(s);});
  await blocked;
  await page.evaluate(()=>{fixedPreviewInvalidate();MSWSubtitleRenderer.invalidate();});
  await page.waitForTimeout(200);release();await ready(page);
  expect(requests).toBe(1);
  expect(await page.evaluate(async()=>(await MSWSubtitleRenderer.renderer.renderer.getStyles()).some(s=>s.FontSize===65))).toBe(true);
});
