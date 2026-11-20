import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer,toggleMediaSettings} from './helpers.mjs';
let server,folder,project;
test.beforeEach(async({page})=>{
  folder=makeTempDir('cue-scale');project=join(folder,'project.mosp');
  process.env.MSW_APP_DATA_ROOT=join(folder,'local');process.env.MAW_ENV_FILE=join(folder,'isolated.env');
  const video=join(folder,'synthetic.mp4');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=25:d=6','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media:video,segments:[{id:'m',start:0,end:6000,text:'Main subtitle'}],
    multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'s',role:'extension',segments:[{id:'s1',start:0,end:6000,text:'Secondary subtitle'}]}],
      bindings:[{id:'b',track_id:'s',main_segment_ids:['m'],extension_segment_ids:['s1']}]},waveform:generateWaveformPayload(6000)}));
  await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,selectBoundSubtitlePair:false,subtitleAvoidControls:false})));
  page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss());
  server=await startServer(project,video,await findFreePort());await page.goto(server.url);
  await page.evaluate(()=>{player.currentTime=1;overlayToggle.checked=true;extensionOverlayToggle.checked=true;MSWSubtitleRenderer.invalidate();});
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleRenderer.status),{timeout:30000}).toBe('libass');await idle(page);
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});await server?.stop();});
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));
async function idle(page){await expect.poll(()=>page.evaluate(()=>!MSWSubtitleRenderer.pending&&MSWPreviewControls.settled),{timeout:15000}).toBe(true);}
const events=page=>page.evaluate(async()=>await MSWSubtitleRenderer.renderer.renderer.getEvents());
const pos=text=>text.match(/\\pos\(([^,]+),([^)]*)\)/).slice(1).map(Number);

test('cue scale handles inherit styles, commit once, cancel safely and persist to ASS',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),style=MSWProjectStyle.defaults();style.main.scaleX=120;style.main.scaleY=80;
    p.subtitles.tracks[0].style={...p.subtitles.tracks[0].style,mode:'snapshot',value:style};
    p.subtitles.cues[0].content.subtitle_style={primaryColor:'#ffee00'};
    productionCommitProject(p,'fixture');selectOnly(0);MSWSubtitleStyle.open('cue');player.currentTime=1;
  });await idle(page);
  const box=page.locator('#cue-scale-box'),handle=box.locator('[data-corner=nw]');await expect(box).toBeVisible();
  const before=await snap(page),history=await page.evaluate(()=>editorHistory.undoLength());
  async function drag(){const b=await handle.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x-45,b.y-20,{steps:5});}
  await drag();expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await expect(page.locator('#fixed-subtitle-preview .fixed-subtitle-text').first()).toBeVisible();
  await page.screenshot({path:info.outputPath('cue-scale-drag.png')});await page.mouse.up();await idle(page);
  const after=await snap(page),scaled=after.subtitles.cues[0].content.subtitle_style;
  expect(scaled.scaleX).toBeGreaterThan(120);expect(scaled.scaleX/scaled.scaleY).toBeCloseTo(1.5,2);expect(scaled.primaryColor).toBe('#ffee00');
  expect(after.subtitles.cues[1]).toEqual(before.subtitles.cues[1]);expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
  expect(after.subtitles.tracks).toEqual(before.subtitles.tracks);
  expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history+1);
  await page.evaluate(()=>performUndo());await idle(page);expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.evaluate(()=>performRedo());await idle(page);expect((await snap(page)).subtitles).toEqual(after.subtitles);
  await drag();await page.keyboard.press('Escape');await page.mouse.up();expect((await snap(page)).subtitles).toEqual(after.subtitles);
  await drag();await box.dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();expect((await snap(page)).subtitles).toEqual(after.subtitles);
  const ass=await page.evaluate(async()=>{const h=MSWE.resolve('processing-host');return (await MSWSubtitleStyle.request('subtitle-preview',{project:h.exportProject(),target:'both',video:{width:640,height:360}})).ass;});
  const style=ass.split('\n').find(line=>line.startsWith('Style: cue-0,')).split(',');
  expect(Number(style[11])).toBe(Math.round(scaled.scaleX));expect(Number(style[12])).toBe(Math.round(scaled.scaleY));
  expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);await page.reload();await idle(page);
  expect((await snap(page)).subtitles).toEqual(after.subtitles);
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('cue');player.currentTime=1;});await idle(page);await expect(box).toBeVisible();
  await page.evaluate(()=>{const p=JSON.parse(buildJson());p.subtitles.tracks[0].locked=true;productionCommitProject(p,'lock');});await expect(box).toBeHidden();
  expect(errors).toEqual([]);
});

test('scale gesture cancels on selection changes and stays within existing style limits',async({page})=>{
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('cue');player.currentTime=1;});await idle(page);
  const box=page.locator('#cue-scale-box'),handle=box.locator('[data-corner=nw]');await expect(box).toBeVisible();
  const before=await snap(page),b=await handle.boundingBox();
  await page.mouse.move(b.x+5,b.y+5);await page.mouse.down();await page.mouse.move(b.x-10000,b.y-10000);
  expect(await page.evaluate(()=>fixedScaleDrag.style.scaleX*fixedScaleDrag.ratio)).toBeLessThanOrEqual(1000);
  await page.evaluate(()=>{selectedIdxs.clear();fixedSchedulePositionSelectionSync();});await page.mouse.up();
  await expect(box).toBeHidden();expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.evaluate(()=>{selectOnly(0);MSWSubtitleStyle.open('cue');});await expect(box).toBeVisible();
  await page.evaluate(()=>player.play());await expect(box).toBeHidden();
});

